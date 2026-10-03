import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import { planDevPlugin } from './vite-plan-plugin'

// 纯前端应用：没有后端，也就没有 /api 代理，数据全部走 src/api/local-service.ts。
// 本地开发环境启动时先跑测报方案示例数据迁移与上线前检查（见 vite-plan-plugin.ts）。
export default defineConfig({
  plugins: [vue(), planDevPlugin()],
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
