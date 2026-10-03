import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { bootstrapPlanVersions } from './data/plan/store'
import './styles/global.css'

// 启动先做示例数据迁移：旧方案缺版本号时按批准时间回填，只追加版本、不改历史原文。
// 已迁移过则空跑，重复执行不会产生第二个有效版本。
bootstrapPlanVersions()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
