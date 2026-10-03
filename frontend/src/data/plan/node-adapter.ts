import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { emptyState } from './store'
import type { PlanState, StorageAdapter } from './types'

/** Node 脚本用的 JSON 文件适配器：迁移游标与版本库落本地文件，可跨次执行续跑。 */
export function createFileAdapter(file: string): StorageAdapter {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<PlanState>
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
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
    },
  }
}

/** 自检用的临时适配器：不落盘。 */
export function createTransientAdapter(initial?: PlanState): StorageAdapter {
  let state: PlanState = initial
    ? (JSON.parse(JSON.stringify(initial)) as PlanState)
    : emptyState()
  return {
    load: () => JSON.parse(JSON.stringify(state)) as PlanState,
    save(next) {
      state = JSON.parse(JSON.stringify(next)) as PlanState
    },
  }
}
