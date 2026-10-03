import {
  listRows,
  saveRows,
} from '@/data/local-store'
import { runAction as applyGenericAction } from '@/api/local-service'
import {
  appendPlanVersion,
  planVersions,
  updatePlanVersion,
} from '@/data/plan-versions'
import {
  FIELD_APPROVED_AT,
  FIELD_PLAN_CODE,
  FIELD_PLAN_NAME,
  type PlanVersion,
  buildVersionNo,
  canArchivePlan,
  checklistOf,
  effectiveVersion,
  isPlanApproved,
} from '@/data/plan-domain'
import type { ActionResult, EntryRow } from '@/data/types'

// 测报方案的动作入口：页面只调这里，判断与版本副作用不散落进组件。

const PLAN_KEY = 'plan'
const ACTION_APPROVE = '批准方案'
const ACTION_REVOKE = '废止方案'

function planRows(): EntryRow[] {
  return listRows(PLAN_KEY)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 批准方案：走通用状态流转；旧方案缺少批准时间时按批准当日回填（只补这一列，不动其他原文），
 * 随后为方案建立唯一有效版本。同一方案再次批准不会产生第二个有效版本。
 */
export function approvePlan(id: number, now: Date = new Date()): ActionResult {
  const before = planRows().find((row) => Number(row.id) === id)
  if (!before) {
    return { ok: false, message: `没有找到编号为 ${id} 的测报方案` }
  }
  // 幂等：已经有有效版本就不重复建立
  if (isPlanApproved(before) && effectiveVersion(planVersions(), id)) {
    return { ok: false, message: '该方案已存在有效版本，无需重复批准' }
  }

  const result = applyGenericAction(PLAN_KEY, id, ACTION_APPROVE)
  if (!result.ok) {
    return result
  }

  // 回填批准时间：只在原列缺失时补写，已有值绝不覆盖
  const rows = planRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  const approvedRow = rows[index]
  const hadApprovedAt = String(approvedRow[FIELD_APPROVED_AT] ?? '').trim().length > 0
  const approvedAt = hadApprovedAt ? String(approvedRow[FIELD_APPROVED_AT]).trim() : today()
  if (!hadApprovedAt) {
    rows[index] = { ...approvedRow, [FIELD_APPROVED_AT]: approvedAt }
    saveRows(PLAN_KEY, rows)
  }

  // 同方案旧有效版本随重新批准失效，始终保持每方案至多一个有效版本
  for (const version of planVersions()) {
    if (version.planId === id && version.effective) {
      updatePlanVersion(version.versionNo, { effective: false })
    }
  }
  const usedVersionNos = new Set(planVersions().map((version) => version.versionNo))
  const finalRow = listRows(PLAN_KEY)[index]
  const version: PlanVersion = {
    versionNo: buildVersionNo(approvedAt, usedVersionNos),
    planId: id,
    planCode: String(finalRow[FIELD_PLAN_CODE] ?? ''),
    planName: String(finalRow[FIELD_PLAN_NAME] ?? ''),
    approvedAt,
    checklist: checklistOf(finalRow),
    original: JSON.parse(JSON.stringify(finalRow)) as EntryRow,
    archived: false,
    effective: true,
    source: 'approval',
    createdAt: now.toISOString(),
  }
  appendPlanVersion(version)
  return {
    ok: true,
    message: `方案已批准，版本号 ${version.versionNo}（批准时间 ${approvedAt}）`,
  }
}

/** 废止方案：状态流转后，该方案所有历史有效版本联动失效。 */
export function revokePlan(id: number): ActionResult {
  const result = applyGenericAction(PLAN_KEY, id, ACTION_REVOKE)
  if (!result.ok) {
    return result
  }
  for (const version of planVersions()) {
    if (version.planId === id && version.effective) {
      updatePlanVersion(version.versionNo, { effective: false })
    }
  }
  return { ok: true, message: result.message }
}

/** 归档：版本留痕标记为已归档，方案原文不动。入口可见性走 canArchivePlan。 */
export function archivePlan(id: number, now: Date = new Date()): ActionResult {
  const row = planRows().find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的测报方案` }
  }
  const versions = planVersions()
  if (!canArchivePlan(row, versions)) {
    return { ok: false, message: '当前方案状态不允许归档：需先批准并生成有效版本' }
  }
  const target = effectiveVersion(versions, id)
    ?? versions.find((item) => item.planId === id && !item.archived)
  if (!target) {
    return { ok: false, message: '没有找到可归档的方案版本' }
  }
  updatePlanVersion(target.versionNo, {
    archived: true,
    archivedAt: now.toISOString(),
    effective: false,
  })
  return { ok: true, message: `方案版本 ${target.versionNo} 已归档，历史原文保持不变` }
}

/** 页面动作按钮的统一可见性判断（页面、版本检查、归档入口同一套写法）。 */
export function planActionAvailability(row: EntryRow): Record<string, boolean> {
  const status = String(row.status)
  const versions = planVersions()
  return {
    提交审批: status === '编制中',
    批准方案:
      status === '待审批'
      || (isPlanApproved(row) && !effectiveVersion(versions, row.id)),
    废止方案: status !== '已废止' && status !== '编制中',
    归档: canArchivePlan(row, versions),
  }
}
