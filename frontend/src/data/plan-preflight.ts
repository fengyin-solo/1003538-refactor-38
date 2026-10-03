import {
  FIELD_PLAN_CODE,
  type PlanVersion,
  approvedAtOf,
  checklistOf,
  effectiveVersion,
  isPlanApproved,
  isPlanPendingApproval,
  isPlanRevoked,
} from './plan-domain'
import type { EntryRow } from './types'

// 上线前检查只从一个快照取数：方案状态、站房维护待办、巡检清单核对都用同一批数据，
// 报告上带同一个批次号，保证三处核对结论互相对得上。

export type PreflightIssue = {
  section: '方案状态' | '站房维护待办' | '巡检清单'
  level: 'error' | 'warning'
  message: string
}

export type PreflightSnapshot = {
  batchId: string
  takenAt: string
  plans: EntryRow[]
  stationhouse: EntryRow[]
  inspections: EntryRow[]
  versions: PlanVersion[]
}

export type PreflightReport = {
  batchId: string
  takenAt: string
  issues: PreflightIssue[]
  summary: {
    approvedPlans: number
    pendingApprovals: number
    stationhouseTodos: number
    inspectionTodos: number
  }
}

// 站房维护：完成、验收即闭环；巡检：已巡检、已处置即闭环
const STATIONHOUSE_OPEN_STATUSES = ['待安排', '已安排', '施工中']
const INSPECTION_OPEN_STATUSES = ['待巡检', '发现故障']

function snapshot(
  rows: Record<string, EntryRow[]>,
  versions: PlanVersion[],
  now: Date = new Date(),
): PreflightSnapshot {
  return {
    batchId: `CHK${now.getTime()}`,
    takenAt: now.toISOString(),
    plans: [...(rows.plan ?? [])],
    stationhouse: [...(rows.stationhouse ?? [])],
    inspections: [...(rows.inspection ?? [])],
    versions: [...versions],
  }
}

function checkPlanStatuses(snap: PreflightSnapshot, issues: PreflightIssue[]): void {
  for (const row of snap.plans) {
    const code = String(row[FIELD_PLAN_CODE] ?? row.id)
    if (isPlanApproved(row) && !approvedAtOf(row)) {
      issues.push({
        section: '方案状态',
        level: 'error',
        message: `方案 ${code} 已批准但缺少批准时间，无法回填版本号`,
      })
    }
    const ownVersions = snap.versions.filter((version) => version.planId === row.id)
    const active = ownVersions.filter(
      (version) => version.effective && !version.archived,
    )
    if (isPlanApproved(row) && ownVersions.length === 0) {
      issues.push({
        section: '方案状态',
        level: 'error',
        message: `方案 ${code} 已批准但没有任何版本记录，需先执行示例数据迁移`,
      })
    }
    if (active.length > 1) {
      issues.push({
        section: '方案状态',
        level: 'error',
        message: `方案 ${code} 存在 ${active.length} 个有效版本，每方案只允许一个有效版本`,
      })
    }
    if (!isPlanRevoked(row) && active.length === 0 && ownVersions.some((version) => version.archived)) {
      issues.push({
        section: '方案状态',
        level: 'warning',
        message: `方案 ${code} 的版本已归档，现场将无有效版本可执行，请确认后续方案`,
      })
    }
    if (isPlanRevoked(row) && active.length > 0) {
      issues.push({
        section: '方案状态',
        level: 'error',
        message: `方案 ${code} 已废止但仍挂着有效版本，版本应随废止失效`,
      })
    }
    if (isPlanPendingApproval(row) && active.length > 0) {
      issues.push({
        section: '方案状态',
        level: 'warning',
        message: `方案 ${code} 尚在待审批，却已生成版本记录，请核对审批流`,
      })
    }
  }
}

function checkStationhouseTodos(snap: PreflightSnapshot, issues: PreflightIssue[]): number {
  // 待办口径在方案状态、站房页面、本检查之间保持一致：未闭环状态且 pending=true
  const todos = snap.stationhouse.filter(
    (row) =>
      STATIONHOUSE_OPEN_STATUSES.includes(String(row.status)) && row.pending === true,
  )
  if (todos.length > 0) {
    const names = todos
      .slice(0, 5)
      .map((row) => String(row['记录编号'] ?? row.id))
      .join('、')
    issues.push({
      section: '站房维护待办',
      level: 'warning',
      message: `上线前仍有 ${todos.length} 项站房维护待办（${names}${todos.length > 5 ? ' 等' : ''}），请确认责任人与计划工期`,
    })
  }
  for (const row of snap.stationhouse) {
    const open = STATIONHOUSE_OPEN_STATUSES.includes(String(row.status))
    if (open !== row.pending) {
      issues.push({
        section: '站房维护待办',
        level: 'error',
        message: `站房维护记录 ${String(row['记录编号'] ?? row.id)} 状态「${row.status}」与待办标记不一致（pending=${String(row.pending)}）`,
      })
    }
  }
  return todos.length
}

function checkInspection(snap: PreflightSnapshot, issues: PreflightIssue[]): number {
  // 巡检清单必须挂在方案的同一个有效版本上：清单以版本里拍的快照为准
  const checklistsByPlan = new Map<number, { versionNo: string; checklist: string[] }>()
  for (const row of snap.plans) {
    if (!isPlanApproved(row)) {
      continue
    }
    const active = effectiveVersion(snap.versions, row.id)
    if (!active) {
      continue
    }
    checklistsByPlan.set(row.id, { versionNo: active.versionNo, checklist: active.checklist })
    if (active.checklist.length === 0) {
      issues.push({
        section: '巡检清单',
        level: 'error',
        message: `方案 ${String(row[FIELD_PLAN_CODE] ?? row.id)} 的有效版本 ${active.versionNo} 巡检清单为空`,
      })
    }
  }

  const todos = snap.inspections.filter(
    (row) =>
      INSPECTION_OPEN_STATUSES.includes(String(row.status)) && row.pending === true,
  )
  if (todos.length > 0) {
    const names = todos
      .slice(0, 5)
      .map((row) => String(row['记录编号'] ?? row.id))
      .join('、')
    issues.push({
      section: '巡检清单',
      level: 'warning',
      message: `仍有 ${todos.length} 条巡检待办（${names}${todos.length > 5 ? ' 等' : ''}），上线前请确认处置安排`,
    })
  }
  for (const row of snap.inspections) {
    const open = INSPECTION_OPEN_STATUSES.includes(String(row.status))
    if (open !== row.pending) {
      issues.push({
        section: '巡检清单',
        level: 'error',
        message: `巡检记录 ${String(row['记录编号'] ?? row.id)} 状态「${row.status}」与待办标记不一致（pending=${String(row.pending)}）`,
      })
    }
  }

  // 清单条目必须能在巡检执行记录里找到落点（检查项目），避免清单与执行两张皮
  const coveredItems = new Set<string>()
  for (const row of snap.inspections) {
    for (const item of String(row['检查项目'] ?? '')
      .split(/[、,，;；\n]/)
      .map((piece) => piece.trim())
      .filter(Boolean)) {
      coveredItems.add(item)
    }
  }
  for (const [planId, { versionNo, checklist }] of checklistsByPlan) {
    const unused = checklist.filter((item) => !coveredItems.has(item))
    if (unused.length > 0) {
      const plan = snap.plans.find((row) => row.id === planId)
      issues.push({
        section: '巡检清单',
        level: 'warning',
        message: `方案 ${String(plan?.[FIELD_PLAN_CODE] ?? planId)} 版本 ${versionNo} 的清单条目「${unused.join('、')}」尚无巡检记录使用`,
      })
    }
  }
  return todos.length
}

/** 一次性截快照、分三段核对，返回带同一批次号的报告。 */
export function runPreflight(
  rows: Record<string, EntryRow[]>,
  versions: PlanVersion[],
  now: Date = new Date(),
): PreflightReport {
  const snap = snapshot(rows, versions, now)
  const issues: PreflightIssue[] = []
  const stationhouseTodos = checkStationhouseTodos(snap, issues)
  checkPlanStatuses(snap, issues)
  const inspectionTodos = checkInspection(snap, issues)

  return {
    batchId: snap.batchId,
    takenAt: snap.takenAt,
    issues,
    summary: {
      approvedPlans: snap.plans.filter(isPlanApproved).length,
      pendingApprovals: snap.plans.filter(isPlanPendingApproval).length,
      stationhouseTodos,
      inspectionTodos,
    },
  }
}

export function preflightBlockingErrors(report: PreflightReport): PreflightIssue[] {
  return report.issues.filter((issue) => issue.level === 'error')
}
