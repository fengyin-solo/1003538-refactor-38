<template>
  <section class="plan-checklist" data-component="plan-checklist">
    <header class="checklist-head">
      <div>
        <h3>{{ title }}</h3>
        <p class="page-desc">清单项由当前生效的测报方案版本统一派生，所有页面读取同一份方案版本。</p>
      </div>
      <button class="btn ghost" type="button" @click="refresh">刷新方案版本</button>
    </header>

    <p v-if="!groups.length" class="empty-state">当前没有生效的测报方案版本，巡检清单暂不可用</p>

    <article v-for="group in groups" :key="group.versionCode + group.stationCode" class="checklist-card">
      <header class="checklist-card-head">
        <div>
          <strong>{{ group.planNo }} · {{ group.versionCode }}</strong>
          <span v-if="group.backfilled" class="badge warning" title="旧方案缺少批准时间，已按回填基准日生成版本号">
            批准时间回填
          </span>
        </div>
        <span class="checklist-meta">站点 {{ group.stationCode }} · 批准于 {{ group.approvedAt }}</span>
      </header>
      <ul class="checklist-items">
        <li v-for="entry in group.items" :key="entry.item">
          <span class="check-item-name">{{ entry.item }}</span>
          <span class="check-item-schedule">{{ entry.schedule || '测次安排待补充' }}</span>
        </li>
      </ul>
    </article>

    <footer class="page-foot">
      <span>共 {{ groups.length }} 组清单，来自 {{ versionCount }} 个生效方案版本</span>
      <span v-if="lastGeneratedAt">快照时间 {{ lastGeneratedAt }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { planStore } from '@/data/plan/store'
import type { PlanCheckItem, PlanVersion } from '@/data/plan/types'
import { stationCodesOf } from '@/data/plan/policy'

const props = withDefaults(
  defineProps<{
    /** 指定站点时只显示该站点命中的同一方案版本；不传则展示全部生效版本。 */
    stationCode?: string
    title?: string
  }>(),
  { stationCode: '', title: '巡检清单（按生效测报方案版本）' },
)

type ChecklistGroup = {
  planNo: string
  versionCode: string
  stationCode: string
  approvedAt: string
  backfilled: boolean
  items: PlanCheckItem[]
}

const tick = ref(0)
const lastGeneratedAt = ref('')

const groups = computed<ChecklistGroup[]>(() => {
  tick.value
  const store = planStore()
  const state = store.get()
  const wanted = props.stationCode.trim().toUpperCase()
  const result: ChecklistGroup[] = []

  for (const version of state.versions.filter((item): item is PlanVersion => item.effective)) {
    for (const code of stationCodesOf(version)) {
      if (wanted && code !== wanted) continue
      const items = store.checklist(code).filter((item) => item.versionCode === version.versionCode)
      result.push({
        planNo: version.planNo,
        versionCode: version.versionCode,
        stationCode: code,
        approvedAt: version.approvedAt,
        backfilled: version.approvedAtBackfilled,
        items,
      })
    }
  }
  return result
})

const versionCount = computed(() => new Set(groups.value.map((group) => group.versionCode)).size)

function refresh() {
  lastGeneratedAt.value = new Date().toLocaleString()
  tick.value += 1
}

onMounted(refresh)
</script>

<style scoped>
.plan-checklist {
  margin-top: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
}
.checklist-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.checklist-head h3 {
  margin: 0;
  font-size: 15px;
}
.checklist-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  margin-top: 10px;
}
.checklist-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.checklist-meta {
  color: var(--muted);
  font-size: 12px;
}
.checklist-items {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 6px 16px;
}
.checklist-items li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  border-bottom: 1px dashed var(--border);
  padding: 2px 0;
}
.check-item-schedule {
  color: var(--muted);
  font-size: 12px;
}
.badge {
  display: inline-block;
  margin-left: 8px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.warning {
  background: #fef3c7;
  color: #92400e;
}
</style>
