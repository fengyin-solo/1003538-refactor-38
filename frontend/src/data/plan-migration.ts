import {
  FIELD_PLAN_CODE,
  FIELD_PLAN_NAME,
  type PlanVersion,
  approvedAtOf,
  buildVersionNo,
  checklistOf,
  isPlanApproved,
} from './plan-domain'
import type { EntryRow } from './types'

// 示例数据迁移：把旧方案补齐为「方案 + 版本」结构。
// 纯函数 + 持久化游标：中断后从未处理方案继续；同一方案已存在有效版本就跳过，
// 重复执行不会产生第二个有效版本。迁移只往版本库里追加，绝不改历史方案原文。

export const MIGRATION_NAME = 'plan-versions-v1'

export type PlanMigrationSnapshot = {
  versions: PlanVersion[]
}

export type PlanMigrationStep = {
  planId: number
  status: 'versioned' | 'skipped' | 'blocked'
  versionNo?: string
  reason?: string
}

export type PlanMigrationResult = {
  fromIndex: number
  processed: PlanMigrationStep[]
  versions: PlanVersion[]
  // 全部方案处理完毕（无 blocked）才算迁移完成，游标才推进到末尾
  done: boolean
  nextIndex: number
}

function cloneRow(row: EntryRow): EntryRow {
  return JSON.parse(JSON.stringify(row)) as EntryRow
}

/**
 * 从 cursor 指定的方案开始处理。
 * @param plans   方案原文（只读，函数内不会改动任何一行）
 * @param versions 已落库的版本（历史执行产物）
 * @param cursor  上次处理到的位置；中断重跑时从这里继续
 */
export function migratePlanVersions(
  plans: EntryRow[],
  versions: PlanVersion[],
  cursor: number,
  now: Date = new Date(),
): PlanMigrationResult {
  const startIndex = Math.min(Math.max(cursor, 0), plans.length)
  const next = [...versions]
  const steps: PlanMigrationStep[] = []
  let index = startIndex

  for (; index < plans.length; index += 1) {
    const row = plans[index]

    // 幂等闸 1：该方案已经有版本（上次中断前已写入），直接跳过，不产生第二个版本
    const existed = next.find((version) => version.planId === row.id)
    if (existed) {
      steps.push({
        planId: row.id,
        status: 'skipped',
        versionNo: existed.versionNo,
        reason: '版本已存在',
      })
      continue
    }

    if (!isPlanApproved(row)) {
      steps.push({ planId: row.id, status: 'skipped', reason: '方案尚未批准' })
      continue
    }

    const approvedAt = approvedAtOf(row)
    if (!approvedAt) {
      // 数据修复（补批准时间）后重跑，游标还停在这里，会从这条继续
      steps.push({ planId: row.id, status: 'blocked', reason: '已批准方案缺少批准时间，无法回填版本号' })
      break
    }

    const usedVersionNos = new Set(next.map((version) => version.versionNo))
    const versionNo = buildVersionNo(approvedAt, usedVersionNos)
    next.push({
      versionNo,
      planId: row.id,
      planCode: String(row[FIELD_PLAN_CODE] ?? ''),
      planName: String(row[FIELD_PLAN_NAME] ?? ''),
      approvedAt,
      checklist: checklistOf(row),
      original: cloneRow(row),
      archived: false,
      effective: true,
      source: 'migration',
      createdAt: now.toISOString(),
    })
    steps.push({ planId: row.id, status: 'versioned', versionNo })
  }

  const blocked = steps.some((step) => step.status === 'blocked')
  return {
    fromIndex: startIndex,
    processed: steps,
    versions: next,
    done: !blocked && index >= plans.length,
    // 循环正常结束时 index 为 plans.length；blocked 跳出时停在该方案下标，
    // 修复批准时间后重跑即从这条继续，不会跳过任何方案
    nextIndex: index,
  }
}
