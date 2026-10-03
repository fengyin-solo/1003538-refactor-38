#!/usr/bin/env node
// 用 vite 自带的 esbuild 把 scripts/plan/*.ts 打包成临时 ESM 再执行，
// 这样脚本能直接 import src 下的 TS/领域代码，浏览器与命令行共用一套迁移逻辑。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// scripts/plan/ 的上两级才是 frontend 根目录。
const root = resolve(here, '..', '..')
const entry = resolve(root, process.argv[2])
const forwarded = process.argv.slice(3)

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // 默认把依赖全部打进 data: URL（含 vue 的响应式工具）；node 内置模块仍自动外置。
  write: false,
  logLevel: 'silent',
})

const code = result.outputFiles[0].text
const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
process.argv = [process.argv[0], entry, ...forwarded]
await import(dataUrl)
