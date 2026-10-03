import type { EntryRow } from './types'

// 测报方案的所有判断都集中在这一个文件：页面动作可见性、版本检查、归档入口、
// 上线前检查与迁移流程都调这里的谓词，不再各写各的字符串判断。

export const PLAN_MODULE_KEY = 'plan'

// 方案状态（与 data/modules.ts 中 plan.statuses 保持同一批定义）
export const PLAN_STATUS_DRAFT = '编制中'
export const PLAN_STATUS_PENDING = '待审批'
export const PLAN_STATUS_APPROVED = '已批准'
export const PLAN_STATUS_REVISED = '已修订'
export const PLAN_STATUS_REVOKED = '已废止'

export const PLAN_APPROVED_STATUSES = [PLAN_STATUS_APPROVED, PLAN_STATUS_REVISED] as const

// 方案记录上承载业务信息的字段
export const FIELD_PLAN_CODE = '方案编号'
export const FIELD_PLAN_NAME = '方案名称'
export const FIELD_APPROVED_AT = '批准时间'
export const FIELD_CHECKLIST = '巡检清单'

// 版本库里一条版本记录。历史版本必须留痕，所以只允许追加，不允许改写原文。
export type PlanVersion = {
  versionNo: string
  planId: number
  planCode: string
  planName: string
  approvedAt: string
  checklist: string[]
  // 迁移时对原文拍的快照；归档、废止都不改它，保证历史方案原文可追溯
  original: EntryRow
  archived: boolean
  archivedAt?: string
  effective: boolean
  source: 'migration' | 'approval'
  createdAt: string
}

export function planStatusOf(row: EntryRow): string {
  return String(row.status ?? '')
}

/** 已批准（含批准后修订）状态，页面、版本检查、归档入口共用这一处判断。 */
export function isPlanApproved(row: EntryRow): boolean {
  return (PLAN_APPROVED_STATUSES as readonly string[]).includes(planStatusOf(row))
}

export function isPlanRevoked(row: EntryRow): boolean {
  return planStatusOf(row) === PLAN_STATUS_REVOKED
}

export function isPlanPendingApproval(row: EntryRow): boolean {
  return planStatusOf(row) === PLAN_STATUS_PENDING
}

export function approvedAtOf(row: EntryRow): string {
  return String(row[FIELD_APPROVED_AT] ?? '').trim()
}

export function checklistOf(row: EntryRow): string[] {
  return splitChecklist(row[FIELD_CHECKLIST])
}

export function splitChecklist(value: string | number | boolean | undefined): string[] {
  return String(value ?? '')
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** 一个方案只允许有一个有效版本：最新且未归档、方案本身未废止。 */
export function effectiveVersion(versions: PlanVersion[], planId: number): PlanVersion | undefined {
  return versions
    .filter(
      (version) =>
        version.planId === planId &&
        version.effective &&
        !version.archived,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
}

/**
 * 生成版本号。已批准但缺版本号的历史方案按批准时间回填：V + 年月日；
 * 同一批准日已有版本时追加序号，绝不重复。
 */
export function buildVersionNo(approvedAt: string, usedVersionNos: Set<string>): string {
  const day = approvedAt.slice(0, 10).replace(/-/g, '')
  const base = `V${day}`
  if (!usedVersionNos.has(base)) {
    return base
  }
  let seq = 2
  while (usedVersionNos.has(`${base}-${seq}`)) {
    seq += 1
  }
  return `${base}-${seq}`
}

/**
 * 归档入口的统一判断：已批准方案必须已回填版本号才能归档；
 * 已废止方案可直接归档（版本随废止失效）。编制中、待审批不开放归档入口。
 */
export function canArchivePlan(row: EntryRow, versions: PlanVersion[]): boolean {
  if (isPlanRevoked(row)) {
    return versions.some(
      (version) => version.planId === row.id && !version.archived,
    )
  }
  if (!isPlanApproved(row)) {
    return false
  }
  return effectiveVersion(versions, row.id) !== undefined
}
