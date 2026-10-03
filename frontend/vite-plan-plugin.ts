import type { Plugin } from 'vite'

import { runMigrationPipeline } from './src/data/plan/pipeline'

// 本地开发环境纳入迁移流程：dev server 启动时把示例数据迁移一遍并做上线前检查。
// 与 prebuild、plan:migrate 共用同一条管线，不另写判断。
export function planDevPlugin(): Plugin {
  return {
    name: 'plan-version-bootstrap',
    apply: 'serve',
    configureServer() {
      const started = Date.now()
      try {
        const result = runMigrationPipeline({
          now: new Date(started).toISOString(),
          stateFile: undefined,
        })
        const m = result.migration
        // eslint-disable-next-line no-console
        console.log(
          `\n[测报方案] 示例数据迁移：处理 ${m?.processed ?? 0} 条，新增有效版本 ${m?.effectiveCreated ?? 0} 个` +
            `（断点续跑=${m?.resumed ? '是' : '否'}，已存在则空跑）`,
        )
        if (result.selfCheck.length === 0) {
          // eslint-disable-next-line no-console
          console.log('[测报方案] 迁移自检通过：中断可续跑，重复执行不产生第二个有效版本')
        }
        const p = result.preflight
        // eslint-disable-next-line no-console
        console.log(
          `[测报方案] 上线前检查${p.ok ? '通过' : '未通过'}：方案状态/站房待办/巡检清单同一快照，问题 ${p.issues.length} 条`,
        )
        for (const issue of p.issues) {
          // eslint-disable-next-line no-console
          console.log(`  [${issue.level}] ${issue.code} ${issue.message}`)
        }
        for (const issue of result.selfCheck) {
          // eslint-disable-next-line no-console
          console.log(`  [${issue.level}] ${issue.code} ${issue.message}`)
        }
      } catch (error) {
        // 检查失败不阻断本地开发，只打印，页面仍可打开排查。
        // eslint-disable-next-line no-console
        console.error('[测报方案] 开发环境迁移/检查异常：', error)
      }
    },
  }
}
