import { resolve } from 'node:path'

import { SEED_ROWS } from '../seed'
import { planStoreWith } from './store'
import { createFileAdapter, createTransientAdapter } from './node-adapter'
import { runMigration } from './policy'
import type { CheckIssue, MigrationReport, PlanPreflightReport, PlanState } from './types'
import type { EntryRow } from '../types'

export const DEFAULT_STATE_FILE = resolve(process.cwd(), '.plan-state', 'plan-versions.json')

export type PipelineResult = {
  ok: boolean
  migration?: MigrationReport
  selfCheck: CheckIssue[]
  preflight: PlanPreflightReport
  stateFile: string
}

function seedPlans(): EntryRow[] {
  return SEED_ROWS.plan.map((row) => ({ ...row }))
}

/**
 * 迁移自检：在不落盘的临时版本库上验证两条硬保证
 * 1. 断点续跑：limit=1 逐条跑，结果必须与一次性全量迁移一致；
 * 2. 幂等：全量迁移后再跑一遍，不能产生第二个有效版本。
 */
export function verifyMigrationInvariants(now: string): CheckIssue[] {
  const issues: CheckIssue[] = []
  const plans = seedPlans()

  // 1) 断点续跑：从空库开始，每次只处理 1 条，直到全部 processed。
  const stepAdapter = createTransientAdapter()
  let guard = 0
  for (;;) {
    const store = planStoreWith(stepAdapter)
    const before = store.get()
    const report = store.migrate({ now, limit: 1 })
    const after = store.get()
    if (after.processedPlanIds.length === before.processedPlanIds.length) break
    if (report.processed > 1) {
      issues.push({ level: 'error', code: 'MIGRATE_BATCH_LIMIT', message: '单批限制未生效：一次处理超过 1 条' })
      break
    }
    guard += 1
    if (guard > plans.length + 2) {
      issues.push({ level: 'error', code: 'MIGRATE_RESUME_STUCK', message: '断点续跑无法收敛，可能从未处理方案继续的游标失效' })
      break
    }
  }

  // 2) 全量基准：一次性迁移，所有应出版方案都恰好一个版本。
  const fullStore = planStoreWith(createTransientAdapter())
  const fullReport = fullStore.migrate({ now })

  const stepped = planStoreWith(stepAdapter).get()
  if (stepped.versions.length !== fullReport.state.versions.length) {
    issues.push({
      level: 'error',
      code: 'MIGRATE_RESUME_MISMATCH',
      message: `断点续跑后版本数 ${stepped.versions.length} 与全量迁移 ${fullReport.state.versions.length} 不一致`,
    })
  }
  const sameVersionCodes =
    stepped.versions.map((item) => item.versionCode + item.planId).sort().join('|') ===
    fullReport.state.versions.map((item) => item.versionCode + item.planId).sort().join('|')
  if (!sameVersionCodes) {
    issues.push({ level: 'error', code: 'MIGRATE_RESUME_CODES', message: '断点续跑生成的版本号/归属与全量迁移不一致' })
  }

  // 3) 幂等：对已迁移完成的状态重复迁移，不允许新增版本。
  const repeatStore = planStoreWith(createTransientAdapter(cloneState(fullStore.get())))
  const repeat = repeatStore.migrate({ now })
  if (repeat.versionsCreated !== 0 || repeat.effectiveCreated !== 0) {
    issues.push({
      level: 'error',
      code: 'MIGRATE_NOT_IDEMPOTENT',
      message: `重复迁移产生了 ${repeat.versionsCreated} 个版本（其中有效 ${repeat.effectiveCreated} 个），必须为 0`,
    })
  }
  for (const planId of new Set(fullStore.get().versions.map((item) => item.planId))) {
    const effectiveCount = repeatStore
      .get()
      .versions.filter((item) => item.planId === planId && item.effective).length
    if (effectiveCount > 1) {
      issues.push({
        level: 'error',
        code: 'MIGRATE_DUPLICATE_EFFECTIVE',
        message: `方案 ${planId} 重复迁移后出现 ${effectiveCount} 个有效版本，必须只有 1 个`,
      })
    }
  }

  // 4) 历史原文保护：版本快照必须保留批准当时的原文。
  for (const version of fullStore.get().versions) {
    const source = plans.find((row) => Number(row.id) === version.planId)
    if (!source) continue
    const nameKept = String(version.snapshot['方案名称'] ?? '') === String(source['方案名称'] ?? '')
    if (!nameKept) {
      issues.push({
        level: 'error',
        code: 'MIGRATE_SNAPSHOT_OVERWRITTEN',
        message: `方案 ${version.planNo} 版本快照原文被覆盖，迁移只能追加版本不能改写历史方案原文`,
      })
    }
  }
  return issues
}

function cloneState(state: PlanState): PlanState {
  return JSON.parse(JSON.stringify(state)) as PlanState
}

/** 直接对纯函数的断言入口：供脚本与潜在测试复用。 */
export function migrateSeedOnce(state: PlanState, now: string, limit?: number): MigrationReport {
  return runMigration(state, seedPlans(), { now, limit })
}

/**
 * 示例数据迁移流程（npm run plan:migrate）：
 * 读 seed.ts → 迁移到本地状态文件（可 --limit N 演示断点续跑）→ 自检 → 同快照上线检查。
 */
export function runMigrationPipeline(options: {
  now: string
  stateFile?: string
  limit?: number
}): PipelineResult {
  const stateFile = options.stateFile ?? DEFAULT_STATE_FILE
  const store = planStoreWith(createFileAdapter(stateFile))
  const migration = store.migrate({ now: options.now, limit: options.limit })
  const selfCheck = verifyMigrationInvariants(options.now)
  const preflight = store.preflight('构建前示例数据快照')
  return {
    ok: !selfCheck.some((item) => item.level === 'error') && preflight.ok,
    migration,
    selfCheck,
    preflight,
    stateFile,
  }
}

/**
 * 构建前检查（prebuild）：示例数据全量迁移到临时版本库后，
 * 在同一份数据快照上核对方案状态、站房维护待办、巡检清单。
 */
export function runPreflightOnly(options: { now: string }): PipelineResult {
  const store = planStoreWith(createTransientAdapter())
  const migration = store.migrate({ now: options.now })
  const selfCheck = verifyMigrationInvariants(options.now)
  const preflight = store.preflight('构建前示例数据快照')
  return {
    ok: !selfCheck.some((item) => item.level === 'error') && preflight.ok,
    migration,
    selfCheck,
    preflight,
    stateFile: '(内存临时版本库，不落盘)',
  }
}
