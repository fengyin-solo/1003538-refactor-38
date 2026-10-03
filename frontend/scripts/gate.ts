import { migratePlanVersions, type PlanMigrationResult } from '../src/data/plan-migration'
import {
  preflightBlockingErrors,
  runPreflight,
  type PreflightReport,
} from '../src/data/plan-preflight'
import type { PlanVersion } from '../src/data/plan-domain'
import type { EntryRow } from '../src/data/types'
import type { FileStore } from './file-store'

// 构建前检查 / dev 启动检查共用同一段编排：
// 先把示例数据迁移跑到完成（中断后从文件里的游标继续），再用同一批数据做上线前核对。

export const VERSIONS_KEY = 'plan-versions'
export const CURSOR_KEY = 'plan-migration-cursor'

export type GateOutcome = {
  migration: PlanMigrationResult
  versionedTotal: number
  report: PreflightReport
  blocking: ReturnType<typeof preflightBlockingErrors>
}

function runMigrationToDone(
  plans: EntryRow[],
  store: FileStore,
): { result: PlanMigrationResult; versionedTotal: number } {
  const versions = store.readJSON<PlanVersion[]>(VERSIONS_KEY, [])
  const beforeCount = versions.length
  const cursor = store.readJSON<number>(CURSOR_KEY, 0)
  // 一次切片从游标跑到完成或阻断：处理一条落一条，中断后游标停在未处理方案
  const result = migratePlanVersions(plans, versions, cursor)
  if (result.versions !== versions) {
    store.writeJSON(VERSIONS_KEY, result.versions)
  }
  store.writeJSON(CURSOR_KEY, result.nextIndex)
  return {
    result,
    versionedTotal: store.readJSON<PlanVersion[]>(VERSIONS_KEY, []).length - beforeCount,
  }
}

export function runGate(rows: Record<string, EntryRow[]>, store: FileStore): GateOutcome {
  const plans = rows.plan ?? []
  const { result: migration, versionedTotal } = runMigrationToDone(plans, store)
  const versions = store.readJSON<PlanVersion[]>(VERSIONS_KEY, [])
  const report = runPreflight(rows, versions)
  return {
    migration,
    versionedTotal,
    report,
    blocking: preflightBlockingErrors(report),
  }
}

export function formatGateOutcome(outcome: GateOutcome): string {
  const lines: string[] = []
  const blocked = outcome.migration.processed.filter((step) => step.status === 'blocked')
  lines.push(
    `[测报方案] 示例数据迁移：本次新增版本 ${outcome.versionedTotal} 个，游标推进至 ${outcome.migration.nextIndex}（中断后从未处理方案继续，重复执行不产生第二个有效版本）`,
  )
  if (blocked.length > 0) {
    lines.push(`[测报方案] 迁移在方案 ${blocked.map((step) => step.planId).join('、')} 处中断：${blocked[0].reason ?? ''}`)
  }
  const { report } = outcome
  lines.push(
    `[测报方案] 上线前检查批次 ${report.batchId}：方案状态/站房维护待办/巡检清单核对同一批数据，共 ${report.issues.length} 项（阻断 ${outcome.blocking.length}）`,
  )
  for (const issue of report.issues) {
    lines.push(`  - [${issue.section}·${issue.level === 'error' ? '阻断' : '提醒'}] ${issue.message}`)
  }
  return lines.join('\n')
}
