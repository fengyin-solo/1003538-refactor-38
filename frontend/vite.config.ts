import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import { planDevGatePlugin } from './vite-plugin-plan-gate'

// 纯前端应用：没有后端，也就没有 /api 代理，数据全部走 src/api/local-service.ts。
// 测报方案的版本迁移与上线前检查在本地 dev 启动时同源执行（仅打印，不阻断起服）；
// 构建前由 npm run build 的 scripts/prebuild-check.js 硬核对，阻断问题会中止构建。
export default defineConfig({
  plugins: [vue(), planDevGatePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
    open: false,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
