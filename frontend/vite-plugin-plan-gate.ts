import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// 测报方案的开发环境闸门：dev server 启动后用模块图加载同一段迁移/检查编排，
// 与构建前检查（scripts/prebuild-check.js）完全同源，只是不阻断本地起服，
// 仅把阻断问题和提醒打印到终端。
export function planDevGatePlugin(): Plugin {
  const stateFile = fileURLToPath(new URL('./.plan-gate-state.json', import.meta.url))
  let ran = false
  return {
    name: 'plan-dev-gate',
    apply: 'serve',
    configureServer(server) {
      // 构建前独立检查脚本（scripts/prebuild-check.js）只借 Vite 的模块图加载 TS，
      // 它自己会执行同一段编排，这里必须跳过，避免迁移被提前跑掉。
      if (process.env.PLAN_GATE_QUIET === '1') {
        return
      }
      return () => {
        if (ran) {
          return
        }
        ran = true
        void (async () => {
          try {
            const [seedModule, gateModule, storeModule] = await Promise.all([
              server.ssrLoadModule('/src/data/seed.ts'),
              server.ssrLoadModule('/scripts/gate.ts'),
              server.ssrLoadModule('/scripts/file-store.ts'),
            ])
            const store = storeModule.createFileStore(stateFile)
            const outcome = gateModule.runGate(seedModule.SEED_ROWS, store)
            const log = server.config.logger
            log.info(gateModule.formatGateOutcome(outcome))
            if (outcome.blocking.length > 0) {
              log.warn(
                `[测报方案] 本地开发检查发现 ${outcome.blocking.length} 个阻断问题（不影响起服，但构建会被中止），见上方明细。`,
              )
            }
          } catch (error) {
            server.config.logger.error(`[测报方案] 本地开发检查执行失败：${String(error)}`)
          }
        })()
      }
    },
  }
}
