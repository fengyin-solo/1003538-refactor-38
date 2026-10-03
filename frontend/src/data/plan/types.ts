import type { EntryRow } from '../types'

/** 测报方案状态：页面渲染、版本检查、归档入口共用，任何地方不得再各自写一份。 */
export const PLAN_STATUS = {
  drafting: '编制中',
  pending: '待审批',
  approved: '已批准',
  revised: '已修订',
  repealed: '已废止',
} as const

export const PLAN_STATUS_SEQUENCE = [
  PLAN_STATUS.drafting,
  PLAN_STATUS.pending,
  PLAN_STATUS.approved,
  PLAN_STATUS.revised,
  PLAN_STATUS.repealed,
] as const

/** 有效（现行）版本只认这两个状态；已废止只剩归档版本。 */
export const EFFECTIVE_STATUSES = [PLAN_STATUS.approved, PLAN_STATUS.revised] as const

/** 进入归档的终态。 */
export const ARCHIVED_STATUSES = [PLAN_STATUS.repealed] as const

/** 方案动作与流转目标：页面只声明触发，能不能做由策略层判断。 */
export const PLAN_ACTIONS = {
  submit: { label: '提交审批', target: PLAN_STATUS.pending },
  approve: { label: '批准方案', target: PLAN_STATUS.approved },
  revise: { label: '修订方案', target: PLAN_STATUS.revised },
  repeal: { label: '废止方案', target: PLAN_STATUS.repealed },
} as const

/** 方案原文参与版本快照的业务字段：版本号、批准时间、状态行不进快照，保证回填不污染原文。 */
export const PLAN_CONTENT_FIELDS = [
  '方案编号',
  '方案名称',
  '适用范围',
  '监测项目',
  '测次安排',
  '编制人',
  '批准人',
] as const

/** 旧方案缺批准时间时的统一回填基准：只回填到版本记录，不写回方案原文。 */
export const LEGACY_APPROVED_AT_FALLBACK = '1970-01-01'

export type PlanPhase = 'draft' | 'pending' | 'effective' | 'archived' | 'unknown'
export type CheckLevel = 'error' | 'warning' | 'info'

export type PlanVersion = {
  /** 版本号：现行方案按批准时间生成，旧方案缺时间按回填基准时间生成。 */
  versionCode: string
  planId: number
  planNo: string
  /** 批准时间（旧方案缺字段时按批准时间回填规则补齐，仅存在于版本记录）。 */
  approvedAt: string
  /** true 表示批准时间来自回填而非方案原文。 */
  approvedAtBackfilled: boolean
  effective: boolean
  archivedAt: string
  /** 批准当时的方案状态：已批准 / 已修订。 */
  statusAtApprove: string
  /** 方案原文快照，迁移只追加版本，永不回写、不覆盖历史方案原文。 */
  snapshot: EntryRow
  contentDigest: string
}

/** 版本库：localStorage 与 Node 脚本共用同一份结构。 */
export type PlanState = {
  /** 已经迁移过的方案 id，断点续跑直接跳过；顺序执行、天然幂等。 */
  processedPlanIds: number[]
  versions: PlanVersion[]
  archivedIds: number[]
  lastMigratedAt: string
}

export type PlanCheckItem = {
  planId: number
  planNo: string
  versionCode: string
  stationCode: string
  item: string
  /** 直接拆自方案版本快照里的「测次安排」原文。 */
  schedule: string
}

export type CheckIssue = {
  level: CheckLevel
  code: string
  message: string
}

/** 上线前检查报告：三类核对跑在同一份数据快照上。 */
export type PlanPreflightReport = {
  ok: boolean
  generatedAt: string
  snapshotLabel: string
  planCount: number
  versionCount: number
  effectiveCount: number
  issues: CheckIssue[]
}

export type PlanSnapshot = {
  generatedAt: string
  label: string
  plans: EntryRow[]
  stationhouseTodos: EntryRow[]
  inspectionRows: EntryRow[]
  versions: PlanVersion[]
}

export type MigrationIssue = { level: CheckLevel; message: string }

export type MigrationReport = {
  /** 本次新处理（推进游标）的方案数，含还没出版本的草稿/待审批方案。 */
  processed: number
  /** 其中真正生成版本的已批准/已废止方案数。 */
  versioned: number
  resumed: boolean
  skipped: number
  versionsCreated: number
  /** 本次产生的有效版本数；幂等重复执行必须为 0。 */
  effectiveCreated: number
  issues: MigrationIssue[]
  state: PlanState
}

export type StorageAdapter = {
  load(): PlanState
  save(state: PlanState): void
}
