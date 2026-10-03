import { runMigrationPipeline, DEFAULT_STATE_FILE } from '../../src/data/plan/pipeline'

// 示例数据迁移流程：node 打包产物 migrate.mjs [--limit N | --limit=N] [--state-file PATH | --state-file=PATH]
const args = process.argv.slice(2)
function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const limitRaw = option('--limit')
const stateFile = option('--state-file') ?? DEFAULT_STATE_FILE
const limitParsed = Number(limitRaw)
const limit = Number.isFinite(limitParsed) ? limitParsed : undefined
const now = new Date().toISOString()

const result = runMigrationPipeline({ now, stateFile, limit: Number.isFinite(limit) ? limit : undefined })

console.log('==== 测报方案 · 示例数据迁移 ====')
console.log(`状态文件：${result.stateFile}`)
if (result.migration) {
  const m = result.migration
  console.log(
    `本次处理 ${m.processed} 条（其中出版 ${m.versioned} 条；断点续跑：${m.resumed ? '是' : '否'}，跳过已处理 ${m.skipped} 条），` +
      `新增版本 ${m.versionsCreated} 个（有效 ${m.effectiveCreated} 个）`,
  )
  for (const item of m.issues) console.log(`[${item.level}] ${item.message}`)
}

console.log('\n==== 迁移保证自检 ====')
if (result.selfCheck.length === 0) {
  console.log('断点续跑 / 幂等 / 历史原文保护 全部通过（重复执行不产生第二个有效版本）')
} else {
  for (const item of result.selfCheck) console.log(`[${item.level}] ${item.code} ${item.message}`)
}

console.log('\n==== 上线前检查（同一快照：方案状态 / 站房待办 / 巡检清单）====')
const p = result.preflight
console.log(`方案 ${p.planCount} 条，版本 ${p.versionCount} 个，有效版本 ${p.effectiveCount} 个`)
if (p.issues.length === 0) {
  console.log('三类核对一致，检查通过')
} else {
  for (const item of p.issues) console.log(`[${item.level}] ${item.code} ${item.message}`)
}

process.exit(result.ok ? 0 : 1)
