import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Node 侧（构建前检查 / dev 启动检查）用的持久化：迁移游标与版本库落文件，
// 中断后重跑从游标继续，与浏览器端 localStorage 的语义一致。

export type FileStore = {
  readJSON<T>(key: string, fallback: T): T
  writeJSON(key: string, value: unknown): void
}

export function createFileStore(stateFile: string): FileStore {
  function ensureDir() {
    mkdirSync(dirname(stateFile), { recursive: true })
  }
  return {
    readJSON<T>(key: string, fallback: T): T {
      try {
        const raw = readFileSync(stateFile, 'utf8')
        const state = JSON.parse(raw) as Record<string, unknown>
        return (key in state ? state[key] : fallback) as T
      } catch {
        return fallback
      }
    },
    writeJSON(key: string, value: unknown): void {
      ensureDir()
      let state: Record<string, unknown> = {}
      try {
        state = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>
      } catch {
        state = {}
      }
      state[key] = value
      writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)
    },
  }
}
