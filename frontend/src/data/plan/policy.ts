import {
  ARCHIVED_STATUSES,
  EFFECTIVE_STATUSES,
  LEGACY_APPROVED_AT_FALLBACK,
  PLAN_ACTIONS,
  PLAN_CONTENT_FIELDS,
  PLAN_STATUS,
  PLAN_STATUS_SEQUENCE,
} from './types'
import type { EntryRow } from '../types'
import type {
  CheckIssue,
  MigrationReport,
  PlanCheckItem,
  PlanPhase,
  PlanPreflightReport,
  PlanSnapshot,
  PlanState,
  PlanVersion,
} from './types'

// 策略层只依赖最小字段集，EntryRow 是它的超集。
type Row = Pick<EntryRow, 'id' | 'status'> & Record<string, string | number | boolean>

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/

function text(row: Row, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value).trim()
}

/** 状态归类：页面徽章、版本检查、动作可用性都以此为准，散落判断收敛到这里。 */
export function phaseOfStatus(status: string): PlanPhase {
  if (status === PLAN_STATUS.drafting || status === PLAN_STATUS.pending) {
    return status === PLAN_STATUS.drafting ? 'draft' : 'pending'
  }
  if ((EFFECTIVE_STATUSES as readonly string[]).includes(status)) return 'effective'
  if ((ARCHIVED_STATUSES as readonly string[]).includes(status)) return 'archived'
  return 'unknown'
}

export function isApprovedLike(row: Row): boolean {
  return phaseOfStatus(row.status) === 'effective'
}

/** 版本号按批准时间回填：取批准时间（可含时分秒）压缩成 V-YYYYMMDD[-HHmmss]。 */
export function versionCodeFromApprovedAt(approvedAt: string): string {
  const compact = approvedAt.replace(/[^0-9]/g, '')
  const day = compact.slice(0, 8)
  const clock = compact.slice(8, 14)
  return clock ? `V-${day}-${clock}` : `V-${day}`
}

/**
 * 旧方案缺少版本号/批准时间时按批准时间回填：
 * 原文有「批准时间」列就读列；否则落到统一回填基准日，只写入版本记录。
 */
export function resolveApprovedAt(row: Row): { approvedAt: string; backfilled: boolean } {
  const raw = text(row, '批准时间')
  const matched = raw.match(DATE_PREFIX)
  if (matched) {
    return { approvedAt: raw.slice(0, clockEnd(raw)), backfilled: false }
  }
  return { approvedAt: LEGACY_APPROVED_AT_FALLBACK, backfilled: true }
}

function clockEnd(raw: string): number {
  // 保留 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm:ss 的数字主体，去掉尾部备注。
  const head = raw.match(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/)
  return head ? head[0].length : 10
}

/** 方案原文指纹：只取业务字段，状态/批准时间/版本号变化不影响历史原文。 */
export function contentDigest(row: Row): string {
  const body = PLAN_CONTENT_FIELDS.map((field) => text(row, field)).join('')
  let hash = 0
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 31 + body.charCodeAt(index)) | 0
  }
  return `c${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function snapshotOf(row: Row): Row {
  const snapshot: Row = { id: row.id, status: row.status }
  for (const field of PLAN_CONTENT_FIELDS) {
    snapshot[field] = text(row, field)
  }
  snapshot['批准时间'] = text(row, '批准时间')
  return snapshot
}

/** 从一条已批准方案生成版本（旧方案回填逻辑集中在这里）。 */
export function buildVersion(row: Row, archived: boolean, now: string): PlanVersion {
  const { approvedAt, backfilled } = resolveApprovedAt(row)
  return {
    versionCode: versionCodeFromApprovedAt(approvedAt),
    planId: Number(row.id),
    planNo: text(row, '方案编号'),
    approvedAt,
    approvedAtBackfilled: backfilled,
    effective: !archived,
    archivedAt: archived ? now : '',
    statusAtApprove: row.status,
    snapshot: snapshotOf(row) as PlanVersion['snapshot'],
    contentDigest: contentDigest(row),
  }
}

/** 当前状态下允许出现的动作（按状态机顺序），页面和版本检查共用。 */
export function availableActions(row: Row): string[] {
  switch (row.status) {
    case PLAN_STATUS.drafting:
      return [PLAN_ACTIONS.submit.label]
    case PLAN_STATUS.pending:
      return [PLAN_ACTIONS.approve.label, PLAN_ACTIONS.repeal.label]
    case PLAN_STATUS.approved:
      return [PLAN_ACTIONS.revise.label, PLAN_ACTIONS.repeal.label]
    case PLAN_STATUS.revised:
      return [PLAN_ACTIONS.repeal.label]
    case PLAN_STATUS.repealed:
      return []
    default:
      return []
  }
}

export function targetOfAction(action: string): string | undefined {
  const hit = Object.values(PLAN_ACTIONS).find((item) => item.label === action)
  return hit?.target
}

export function statusRank(status: string): number {
  const index = (PLAN_STATUS_SEQUENCE as readonly string[]).indexOf(status)
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

/** 「适用范围」按站点编码拆分：STAT-xxxx、逗号/顿号/空白分隔都能识别。 */
export function stationCodesOf(version: PlanVersion): string[] {
  const scope = String(version.snapshot['适用范围'] ?? '')
  const codes = scope.match(/[A-Za-z]{2,}-?\d{2,}/g)
  return codes ? Array.from(new Set(codes.map((code) => code.toUpperCase()))) : []
}

function codeOfRow(row: Row): string {
  return text(row, '站点编号').toUpperCase()
}

/** 当前对某站点生效的方案版本：其他页面的巡检清单统一从这里取版本。 */
export function effectiveVersionFor(
  state: PlanState,
  stationCode: string,
): PlanVersion | undefined {
  const target = stationCode.trim().toUpperCase()
  return state.versions.find(
    (version) => version.effective && stationCodesOf(version).includes(target),
  )
}

/** 巡检清单由生效方案版本派生：同一方案版本 → 同一批清单项。 */
export function checklistOf(state: PlanState, stationCode?: string): PlanCheckItem[] {
  const target = stationCode?.trim().toUpperCase()
  const items: PlanCheckItem[] = []
  for (const version of state.versions) {
    if (!version.effective) continue
    for (const code of stationCodesOf(version)) {
      if (target && code !== target) continue
      const projects = String(version.snapshot['监测项目'] ?? '')
        .split(/[、,，;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
      for (const item of projects) {
        items.push({
          planId: version.planId,
          planNo: version.planNo,
          versionCode: version.versionCode,
          stationCode: code,
          item,
          schedule: String(version.snapshot['测次安排'] ?? ''),
        })
      }
    }
  }
  return items
}

function issue(level: CheckIssue['level'], code: string, message: string): CheckIssue {
  return { level, code, message }
}

/**
 * 迁移引擎：纯函数，不碰存储。
 * - 断点续跑：processedPlanIds 即游标，中断后再次调用从第一批未处理方案继续；
 * - 幂等：已处理方案直接跳过，重复执行不会产生第二个有效版本；
 * - limit：单批最多处理多少条（演示/验证断点续跑用）。
 */
export function runMigration(
  previous: PlanState,
  plans: Row[],
  options: { now: string; limit?: number } = { now: new Date(0).toISOString() },
): MigrationReport {
  const now = options.now
  const processed = new Set(previous.processedPlanIds)
  const versions = previous.versions.map((version) => ({ ...version, snapshot: { ...version.snapshot } }))
  const report: MigrationReport = {
    processed: 0,
    versioned: 0,
    resumed: processed.size > 0,
    skipped: 0,
    versionsCreated: 0,
    effectiveCreated: 0,
    issues: [],
    state: { ...previous, processedPlanIds: [...processed], versions },
  }

  const ordered = [...plans].sort((a, b) => Number(a.id) - Number(b.id))
  let budget = options.limit === undefined ? Number.MAX_SAFE_INTEGER : options.limit

  for (const row of ordered) {
    const id = Number(row.id)
    if (processed.has(id)) {
      report.skipped += 1
      // 即使方案已处理，也要核对当前原文与历史版本快照：只允许保留历史，不允许被覆盖。
      const kept = versions.find((item) => item.planId === id)
      if (kept && kept.contentDigest !== contentDigest(row)) {
        report.issues.push({
          level: 'error',
          message: `方案 ${kept.planNo} 历史版本原文与现方案不一致，已保留历史快照，不覆盖原文`,
        })
      }
      continue
    }
    if (budget <= 0) break
    budget -= 1
    processed.add(id)
    report.processed += 1
    report.state.processedPlanIds = [...processed].sort((a, b) => a - b)

    if (!isApprovedLike(row) && phaseOfStatus(row.status) !== 'archived') {
      // 编制中 / 待审批：还没有可回填的版本，标记已处理即可，后续批准时再建版本。
      continue
    }
    // 已废止但从未批准（无批准时间）：没有可回填的版本，只标记已处理，不硬造版本号。
    if (
      phaseOfStatus(row.status) === 'archived' &&
      resolveApprovedAt(row).backfilled &&
      text(row, '批准时间') === ''
    ) {
      continue
    }
    report.versioned += 1

    const { backfilled } = resolveApprovedAt(row)
    if (backfilled) {
      report.issues.push({
        level: 'warning',
        message: `方案 ${text(row, '方案编号') || id} 缺少批准时间，已按回填基准日 ${LEGACY_APPROVED_AT_FALLBACK} 生成版本号`,
      })
    }

    const version = buildVersion(row, phaseOfStatus(row.status) === 'archived', now)
    const existing = versions.findIndex((item) => item.planId === id)
    if (existing >= 0) {
      // 同一方案只保留一个有效版本：重复迁移命中时以快照原文为准，绝不覆盖历史原文。
      const kept = versions[existing]
      if (kept.contentDigest !== version.contentDigest) {
        report.issues.push({
          level: 'error',
          message: `方案 ${version.planNo} 历史版本原文与现方案不一致，已保留历史快照，不覆盖原文`,
        })
      }
      if (!kept.effective && !version.effective) {
        versions[existing] = { ...kept, archivedAt: kept.archivedAt || version.archivedAt }
      }
      continue
    }
    versions.push(version)
    report.versionsCreated += 1
    if (version.effective) report.effectiveCreated += 1
  }

  report.state.versions = versions
  report.state.lastMigratedAt = now
  return report
}

/** 同一方案只允许一个有效版本（修订即顶替旧版本）。 */
export function ensureSingleEffective(
  state: PlanState,
  planId: number,
): PlanVersion[] {
  return state.versions.map((version) =>
    version.planId === planId ? { ...version, effective: false } : version,
  )
}

/** 上线前检查：方案状态、站房维护待办、巡检清单三类核对共用同一份快照。 */
export function runPreflightChecks(snapshot: PlanSnapshot): PlanPreflightReport {
  const issues: CheckIssue[] = []
  const { plans, stationhouseTodos, inspectionRows, versions } = snapshot

  // 1) 方案状态 ↔ 版本库核对
  for (const row of plans) {
    const planId = Number(row.id)
    const own = versions.filter((version) => version.planId === planId)
    const phase = phaseOfStatus(row.status)
    const planNo = text(row, '方案编号') || `#${planId}`

    if (phase === 'effective') {
      const effective = own.filter((version) => version.effective)
      if (effective.length !== 1) {
        issues.push(
          issue(
            'error',
            'PLAN_EFFECTIVE_VERSION_COUNT',
            `方案 ${planNo} 状态为「${row.status}」，应有 1 个有效版本，实际 ${effective.length} 个`,
          ),
        )
      }
      const current = effective[0]
      if (current && current.contentDigest !== contentDigest(row)) {
        issues.push(
          issue(
            'error',
            'PLAN_VERSION_DIGEST_MISMATCH',
            `方案 ${planNo} 当前原文与生效版本 ${current.versionCode} 快照不一致，请先修订出版本`,
          ),
        )
      }
    } else if (phase === 'archived') {
      if (own.some((version) => version.effective)) {
        issues.push(
          issue(
            'error',
            'PLAN_REPEALED_STILL_EFFECTIVE',
            `方案 ${planNo} 已废止，但版本库里仍存在有效版本`,
          ),
        )
      }
      // 废止且原文有批准时间：曾经批准过，必须保留归档版本；从未批准的废止不要求版本。
      const wasApproved = text(row, '批准时间') !== ''
      if (wasApproved && !own.some((version) => version.archivedAt)) {
        issues.push(
          issue(
            'error',
            'PLAN_ARCHIVE_MISSING',
            `方案 ${planNo} 已废止，但缺少归档版本`,
          ),
        )
      }
    } else if (own.some((version) => version.effective)) {
      issues.push(
        issue(
          'error',
          'PLAN_DRAFT_HAS_VERSION',
          `方案 ${planNo} 尚在「${row.status}」，版本库却已有有效版本`,
        ),
      )
    }
  }

  const effectiveVersions = versions.filter((version) => version.effective)
  for (const version of effectiveVersions) {
    const covered = new Set(stationCodesOf(version))
    const overlap = effectiveVersions
    .filter((other) => other.planId !== version.planId)
    .find((other) => stationCodesOf(other).some((code) => covered.has(code)))
    if (overlap) {
      issues.push(
        issue(
          'error',
          'PLAN_STATION_DOUBLE_COVERED',
          `站点被两个有效方案同时覆盖：${version.planNo}(${version.versionCode}) 与 ${overlap.planNo}(${overlap.versionCode})`,
        ),
      )
    }
  }

  const versionOfStation = new Map<string, PlanVersion>()
  for (const version of effectiveVersions) {
    for (const code of stationCodesOf(version)) versionOfStation.set(code, version)
  }

  // 2) 站房维护待办：必须落在同一批有效方案覆盖的站点内。
  for (const todo of stationhouseTodos) {
    const code = codeOfRow(todo)
    if (!code) {
      issues.push(issue('warning', 'HOUSE_TODO_NO_STATION', `站房维护记录 #${todo.id} 缺少站点编号，无法核对方案覆盖`))
      continue
    }
    const version = versionOfStation.get(code)
    if (!version) {
      issues.push(
        issue(
          'error',
          'HOUSE_TODO_UNCOVERED',
          `站房维护待办 ${text(todo, '记录编号') || todo.id}（${code}）没有任何生效测报方案覆盖`,
        ),
      )
    } else if (version.contentDigest && checklistCovered(version, code).length === 0) {
      issues.push(
        issue(
          'warning',
          'HOUSE_TODO_EMPTY_CHECKLIST',
          `站房维护待办（${code}）命中方案 ${version.planNo}，但该版本监测项目为空，清单无法生成`,
        ),
      )
    }
  }

  // 3) 巡检清单：每条巡检记录都要能追溯到同一方案版本及其清单项。
  for (const row of inspectionRows) {
    const code = codeOfRow(row)
    if (!code) {
      issues.push(issue('warning', 'INSPECTION_NO_STATION', `巡检记录 #${row.id} 缺少站点编号，无法匹配方案版本`))
      continue
    }
    const version = versionOfStation.get(code)
    if (!version) {
      issues.push(
        issue(
          'error',
          'INSPECTION_WITHOUT_PLAN',
          `巡检记录 ${text(row, '记录编号') || row.id}（${code}）读取不到生效方案版本`,
        ),
      )
      continue
    }
    const declared = text(row, '检查项目')
    const known = checklistCovered(version, code)
    if (known.length === 0) {
      issues.push(
        issue(
          'warning',
          'INSPECTION_EMPTY_CHECKLIST',
          `巡检记录（${code}）引用方案 ${version.planNo} ${version.versionCode}，但该版本没有可巡检的监测项目`,
        ),
      )
      continue
    }
    if (declared) {
      const matched = declared
        .split(/[、,，;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .some((item) => known.some((knownItem) => knownItem.item === item))
      if (!matched) {
        issues.push(
          issue(
            'warning',
            'INSPECTION_ITEM_STALE',
            `巡检记录 ${text(row, '记录编号') || row.id}（${code}）的检查项目不在方案 ${version.versionCode} 的清单内，清单已换版`,
          ),
        )
      }
    }
  }

  return {
    ok: !issues.some((item) => item.level === 'error'),
    generatedAt: snapshot.generatedAt,
    snapshotLabel: snapshot.label,
    planCount: plans.length,
    versionCount: versions.length,
    effectiveCount: effectiveVersions.length,
    issues,
  }
}

function checklistCovered(version: PlanVersion, stationCode: string): PlanCheckItem[] {
  const code = stationCode.trim().toUpperCase()
  if (!stationCodesOf(version).includes(code)) return []
  const projects = String(version.snapshot['监测项目'] ?? '')
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  return projects.map((item) => ({
    planId: version.planId,
    planNo: version.planNo,
    versionCode: version.versionCode,
    stationCode: code,
    item,
    schedule: String(version.snapshot['测次安排'] ?? ''),
  }))
}
