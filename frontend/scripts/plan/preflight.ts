import { runPreflightOnly } from '../../src/data/plan/pipeline'

// 构建前检查：先把示例数据全量迁移到临时版本库，再在同一份快照上做三类核对。
const result = runPreflightOnly({ now: new Date().toISOString() })

console.log('==== 测报方案 · 构建前检查 ====')
if (result.migration) {
  const m = result.migration
  console.log(
    `临时迁移：处理 ${m.processed} 条（出版 ${m.versioned} 条），版本 ${m.versionsCreated} 个（有效 ${m.effectiveCreated} 个）；${result.stateFile}`,
  )
}

console.log('\n-- 迁移保证自检 --')
if (result.selfCheck.length === 0) {
  console.log('迁移中断可从未处理方案继续；重复执行不产生第二个有效版本')
} else {
  for (const item of result.selfCheck) console.log(`[${item.level}] ${item.code} ${item.message}`)
}

console.log('\n-- 上线前检查（同一快照）--')
const p = result.preflight
console.log(`方案 ${p.planCount} 条 / 版本 ${p.versionCount} 个 / 有效版本 ${p.effectiveCount} 个`)
if (p.issues.length === 0) {
  console.log('方案状态、站房维护待办、巡检清单核对一致')
} else {
  for (const item of p.issues) console.log(`[${item.level}] ${item.code} ${item.message}`)
}

process.exit(result.ok ? 0 : 1)
