import { allRows, listRows } from './local-store'
import {
  MIGRATION_NAME,
  migratePlanVersions,
  type PlanMigrationResult,
} from './plan-migration'
import {
  PLAN_MODULE_KEY,
  type PlanVersion,
} from './plan-domain'

// 版本库独立存放，方案原文保持不动，迁移只往这里追加。
const VERSION_KEY = 'hydrology-monitor-station:plan-versions'
const CURSOR_KEY = 'hydrology-monitor-station:plan-migration'

const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function subscribePlanVersions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readVersions(): PlanVersion[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(VERSION_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as PlanVersion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeVersions(versions: PlanVersion[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(VERSION_KEY, JSON.stringify(versions))
  }
  notify()
}

function readCursor(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0
  }
  const raw = window.localStorage.getItem(CURSOR_KEY)
  const cursor = raw === null ? 0 : Number.parseInt(raw, 10)
  return Number.isFinite(cursor) && cursor >= 0 ? cursor : 0
}

function writeCursor(cursor: number): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor))
  }
}

/** 迁移是否已经跑完整批方案。 */
export function planMigrationDone(): boolean {
  return readCursor() >= listRows(PLAN_MODULE_KEY).length
}

/**
 * 执行一次迁移切片：从上次游标继续，处理一条落库一条。
 * 重复执行时已存在版本的方案被跳过，不会产生第二个有效版本。
 */
export function runPlanMigration(now: Date = new Date()): PlanMigrationResult {
  const versions = readVersions()
  const plans = listRows(PLAN_MODULE_KEY)
  const cursor = readCursor()

  const result = migratePlanVersions(plans, versions, cursor, now)

  if (result.versions !== versions) {
    writeVersions(result.versions)
  }
  writeCursor(result.nextIndex)
  return result
}

/** 首访兜底：确保示例数据迁移纳入正常启动流程，中断后下次打开继续。 */
export function ensurePlanMigrated(now: Date = new Date()): PlanMigrationResult | null {
  if (planMigrationDone()) {
    return null
  }
  return runPlanMigration(now)
}

/** 全量核对用：版本库随 allRows() 一并取出，保证检查与页面读到同一批数据。 */
export function planVersions(): PlanVersion[] {
  return readVersions()
}

export function allRowsWithVersions(): {
  rows: ReturnType<typeof allRows>
  versions: PlanVersion[]
} {
  return { rows: allRows(), versions: readVersions() }
}

export function appendPlanVersion(version: PlanVersion): PlanVersion[] {
  const versions = [...readVersions(), version]
  writeVersions(versions)
  return versions
}

export function updatePlanVersion(
  versionNo: string,
  patch: Partial<PlanVersion>,
): PlanVersion[] {
  const versions = readVersions().map((version) =>
    version.versionNo === versionNo ? { ...version, ...patch } : version,
  )
  writeVersions(versions)
  return versions
}

export function resetPlanVersions(): void {
  writeVersions([])
  writeCursor(0)
}

export { MIGRATION_NAME, VERSION_KEY, CURSOR_KEY }
