import { computed, ref } from 'vue'

import { listRows, saveRows } from '../local-store'
import {
  availableActions,
  buildVersion,
  checklistOf,
  effectiveVersionFor,
  ensureSingleEffective,
  phaseOfStatus,
  runMigration,
  runPreflightChecks,
  statusRank,
  targetOfAction,
} from './policy'
import { PLAN_ACTIONS, PLAN_STATUS } from './types'
import type {
  CheckIssue,
  MigrationReport,
  PlanCheckItem,
  PlanPreflightReport,
  PlanSnapshot,
  PlanState,
  PlanVersion,
  StorageAdapter,
} from './types'
import type { EntryRow } from '../types'

const PLAN_STATE_KEY = 'hydrology-monitor-station:plan-state'
const PLAN_MODULE = 'plan'

export const emptyState = (): PlanState => ({
  processedPlanIds: [],
  versions: [],
  archivedIds: [],
  lastMigratedAt: '',
})

// ---------- 存储适配器 ----------

export function createLocalStorageAdapter(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof window === 'undefined'
    ? undefined
    : window.localStorage,
): StorageAdapter {
  return {
    load() {
      if (!storage) return emptyState()
      const raw = storage.getItem(PLAN_STATE_KEY)
      if (!raw) return emptyState()
      try {
        const parsed = JSON.parse(raw) as Partial<PlanState>
        return {
          processedPlanIds: Array.isArray(parsed.processedPlanIds) ? parsed.processedPlanIds : [],
          versions: Array.isArray(parsed.versions) ? parsed.versions : [],
          archivedIds: Array.isArray(parsed.archivedIds) ? parsed.archivedIds : [],
          lastMigratedAt: typeof parsed.lastMigratedAt === 'string' ? parsed.lastMigratedAt : '',
        }
      } catch {
        return emptyState()
      }
    },
    save(state) {
      storage?.setItem(PLAN_STATE_KEY, JSON.stringify(state))
    },
  }
}

/** Node 脚本 / 单测用：状态只活在内存或落本地文件，由调用方决定。 */
export function createMemoryAdapter(initial: PlanState = emptyState()): StorageAdapter & {
  current(): PlanState
} {
  let state: PlanState = structuredCloneSafe(initial)
  return {
    load: () => structuredCloneSafe(state),
    save(next) {
      state = structuredCloneSafe(next)
    },
    current: () => structuredCloneSafe(state),
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------- 版本库门面 ----------

/** 版本库每次变更都自增：组件里读这个 ref 即可让版本号、归档徽章、清单联动刷新。 */
export const planStateTick = ref(0)

export class PlanVersionStore {
  private adapter: StorageAdapter
  private state: PlanState

  constructor(adapter?: StorageAdapter) {
    this.adapter = adapter ?? createLocalStorageAdapter()
    this.state = this.adapter.load()
  }

  get(): PlanState {
    // 依赖 tick：在 computed/渲染中调用时，commit 后能触发重新计算。
    void planStateTick.value
    return structuredCloneSafe(this.state)
  }

  private commit(next: PlanState) {
    this.state = next
    this.adapter.save(structuredCloneSafe(next))
    planStateTick.value += 1
  }

  /** 示例数据迁移：断点续跑 + 幂等。limit 用来单批处理若干条，中断后从未处理方案继续。 */
  migrate(options: { now: string; limit?: number }): MigrationReport {
    const report = runMigration(this.state, listRows(PLAN_MODULE), options)
    this.commit(report.state)
    return report
  }

  /**
   * 批准 / 修订方案：把新有效版本入库。
   * 同一方案先把旧版本全部置为失效，因此重复执行不会产生第二个有效版本。
   */
  activateVersion(row: EntryRow, now: string): { ok: boolean; version?: PlanVersion; message: string } {
    const existing = this.state.versions.find((item) => item.planId === Number(row.id))
    const candidate = buildVersion(row, false, now)
    if (existing && existing.effective && existing.contentDigest === candidate.contentDigest) {
      return { ok: true, version: existing, message: `方案 ${candidate.planNo} 的有效版本 ${existing.versionCode} 已存在，未重复出版` }
    }
    const versions = ensureSingleEffective(this.state, Number(row.id))
    const index = versions.findIndex((item) => item.planId === Number(row.id))
    if (index >= 0) {
      versions[index] = candidate
    } else {
      versions.push(candidate)
    }
    this.commit({
      ...this.state,
      versions,
      processedPlanIds: markProcessed(this.state.processedPlanIds, Number(row.id)),
    })
    return { ok: true, version: candidate, message: `方案 ${candidate.planNo} 已生成有效版本 ${candidate.versionCode}` }
  }

  /** 废止：有效版本下架并登记归档，归档版本保留原文快照。 */
  archive(row: EntryRow, now: string): { ok: boolean; version?: PlanVersion; message: string } {
    const planId = Number(row.id)
    const versions = this.state.versions.map((version) =>
      version.planId === planId
        ? { ...version, effective: false, archivedAt: version.archivedAt || now }
        : version,
    )
    let archived = versions.find((version) => version.planId === planId)
    if (!archived) {
      // 从未批准过的方案（编制中/待审批直接废止）没有可回填的批准时间，
      // 不硬造版本，只登记归档标记；已批准方案则补一份历史快照。
      if (phaseOfStatus(String(row.status)) === 'archived' && !textOf(row, '批准时间')) {
        this.commit({
          ...this.state,
          versions,
          archivedIds: markProcessed(this.state.archivedIds, planId),
          processedPlanIds: markProcessed(this.state.processedPlanIds, planId),
        })
        return { ok: true, message: `方案 ${textOf(row, '方案编号') || planId} 已归档（无批准版本，仅登记归档，不生成版本号）` }
      }
      archived = buildVersion(row, true, now)
      versions.push(archived)
    }
    const archivedIds = this.state.archivedIds.includes(planId)
      ? this.state.archivedIds
      : [...this.state.archivedIds, planId]
    this.commit({
      ...this.state,
      versions,
      archivedIds,
      processedPlanIds: markProcessed(this.state.processedPlanIds, planId),
    })
    return { ok: true, version: archived, message: `方案 ${archived.planNo} 已归档（${archived.versionCode}），历史原文快照保留` }
  }

  isArchived(planId: number): boolean {
    return this.state.archivedIds.includes(planId)
  }

  effectiveVersionForStation(stationCode: string): PlanVersion | undefined {
    return effectiveVersionFor(this.state, stationCode)
  }

  checklist(stationCode?: string): PlanCheckItem[] {
    return checklistOf(this.state, stationCode)
  }

  /** 同一份快照交给三类核对：方案状态、站房维护待办、巡检清单。 */
  snapshot(label = '当前本地数据'): PlanSnapshot {
    const stationhouseTodos = listRows('stationhouse').filter((row) => row.pending)
    return {
      generatedAt: new Date().toISOString(),
      label,
      plans: listRows(PLAN_MODULE),
      stationhouseTodos,
      inspectionRows: listRows('inspection'),
      versions: structuredCloneSafe(this.state.versions),
    }
  }

  preflight(label?: string): PlanPreflightReport {
    return runPreflightChecks(this.snapshot(label))
  }
}

function markProcessed(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids : [...ids, id].sort((a, b) => a - b)
}

// ---------- 浏览器单例 ----------

let browserStore: PlanVersionStore | null = null

export function planStore(): PlanVersionStore {
  if (!browserStore) {
    browserStore = new PlanVersionStore(createLocalStorageAdapter())
  }
  return browserStore
}

/** 供 Node 脚本注入指定适配器（文件 / 内存）。 */
export function planStoreWith(adapter: StorageAdapter): PlanVersionStore {
  return new PlanVersionStore(adapter)
}

/** 应用启动与示例数据迁移流程统一入口：已迁移过则空跑，绝不重复出版。 */
export function bootstrapPlanVersions(now: string = new Date().toISOString()): MigrationReport {
  return planStore().migrate({ now })
}

// ---------- 方案动作：页面只调这一个入口 ----------

export type PlanActionOutcome = {
  ok: boolean
  message: string
  issues: CheckIssue[]
}

/**
 * 测报方案统一动作入口：页面按钮、版本检查、归档背后的判断全部走这里，
 * 页面里不再写状态 if/else。动作同时维护方案原文行与版本库。
 */
export function executePlanAction(row: EntryRow, action: string): PlanActionOutcome {
  const issues: CheckIssue[] = []
  if (!availableActions(row).includes(action)) {
    return {
      ok: false,
      message: `方案当前「${row.status}」，不能执行「${action}」`,
      issues,
    }
  }
  const target = targetOfAction(action)
  if (!target) {
    return { ok: false, message: `未登记动作「${action}」`, issues }
  }

  const rows = listRows(PLAN_MODULE)
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  if (index < 0) {
    return { ok: false, message: `没有找到方案 ${row.id}`, issues }
  }
  const current = rows[index]
  if (current.status === target) {
    return { ok: false, message: `方案已经是「${target}」，不用重复操作`, issues }
  }
  if (statusRank(target) < statusRank(current.status)) {
    return { ok: false, message: `方案状态不能从「${current.status}」回退到「${target}」`, issues }
  }

  const now = new Date().toISOString()
  const approvedAt = target === PLAN_STATUS.approved || target === PLAN_STATUS.revised
    ? now.slice(0, 10)
    : textOf(current, '批准时间')
  const updated: EntryRow = {
    ...current,
    status: target,
    // 统一按状态阶段算待办：编制/待审批/有效都可能要继续办，归档才清零。
    pending: phaseOfStatus(target) !== 'archived',
    abnormal: false,
    批准时间: approvedAt,
  }
  const next = [...rows]
  next[index] = updated
  // 唯一一次写方案表：只更新本行的状态字段，历史业务原文不动。
  saveRows(PLAN_MODULE, next)

  const store = planStore()
  if (action === PLAN_ACTIONS.approve.label || action === PLAN_ACTIONS.revise.label) {
    const result = store.activateVersion(updated, now)
    if (!result.ok) return { ok: false, message: result.message, issues }
    return { ok: true, message: result.message, issues }
  }
  if (action === PLAN_ACTIONS.repeal.label) {
    const result = store.archive(updated, now)
    return { ok: true, message: result.message, issues }
  }
  return { ok: true, message: `方案已${action}，当前状态「${target}」`, issues }
}

function textOf(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value)
}

/** 归档入口（页面按钮 / 批量归档共用）：只对已废止且未归档方案生效，重复执行无副作用。 */
export function archiveRepealedPlans(now: string = new Date().toISOString()): {
  archived: number
  skipped: number
  message: string
} {
  const store = planStore()
  let archived = 0
  let skipped = 0
  for (const row of listRows(PLAN_MODULE)) {
    if (phaseOfStatus(row.status) !== 'archived') continue
    if (store.isArchived(Number(row.id))) {
      skipped += 1
      continue
    }
    store.archive(row, now)
    archived += 1
  }
  return {
    archived,
    skipped,
    message:
      archived > 0
        ? `已归档 ${archived} 个废止方案，历史原文快照已保留`
        : '没有待归档的废止方案（重复执行不会产生第二个版本）',
  }
}

export { contentDigest } from './policy'
