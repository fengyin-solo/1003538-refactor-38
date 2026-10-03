// 构建前检查入口（纯 JS，node 直接可跑）：
// 用 Vite 的 ssrLoadModule 加载 scripts/gate.ts 与 src 下的 TS 领域代码（TS 由 Vite 转译），
// 先完成示例数据迁移，再核对方案状态、站房维护待办、巡检清单（同一批数据）。
// 有阻断问题时以非零码退出，`npm run build` 随即中止。
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const stateFile = fileURLToPath(new URL('../.plan-gate-state.json', import.meta.url))

// 借模块图加载 TS，但不让 vite.config.ts 里的 dev 闸门插件抢先执行迁移
process.env.PLAN_GATE_QUIET = '1'

function log(message) {
  process.stdout.write(`${message}\n`)
}

async function main() {
  const server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { middlewareMode: true },
    logLevel: 'silent',
  })
  try {
    const [seedModule, gateModule, storeModule] = await Promise.all([
      server.ssrLoadModule('/src/data/seed.ts'),
      server.ssrLoadModule('/scripts/gate.ts'),
      server.ssrLoadModule('/scripts/file-store.ts'),
    ])
    const store = storeModule.createFileStore(stateFile)
    const outcome = gateModule.runGate(seedModule.SEED_ROWS, store)
    log(gateModule.formatGateOutcome(outcome))
    if (outcome.blocking.length > 0) {
      log(`[测报方案] 构建前检查未通过：${outcome.blocking.length} 个阻断问题，构建已中止。`)
      process.exitCode = 1
    }
  } finally {
    await server.close()
  }
}

main().catch((error) => {
  process.stderr.write(`[测报方案] 构建前检查执行失败：${String(error?.stack ?? error)}\n`)
  process.exitCode = 1
})
