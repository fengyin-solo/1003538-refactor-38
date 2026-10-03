<template>
  <div v-if="activePlan" class="active-plan-banner" data-role="active-plan-banner">
    <span class="banner-label">当前执行测报方案</span>
    <strong>{{ activePlan.planName }}</strong>
    <span class="banner-version">版本 {{ activePlan.version.versionNo }}</span>
    <span class="banner-time">批准于 {{ activePlan.version.approvedAt }}</span>
    <span class="banner-checklist">
      巡检清单（{{ activePlan.checklist.length }} 项）：{{ activePlan.checklist.join('、') || '—' }}
    </span>
    <RouterLink class="banner-link" to="/plan">方案版本管理</RouterLink>
  </div>
  <div v-else class="active-plan-banner is-empty" data-role="active-plan-banner">
    <span>当前没有生效的测报方案版本，请先在测报方案页完成批准或示例数据迁移。</span>
    <RouterLink class="banner-link" to="/plan">前往处理</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { useActivePlan } from '@/stores/active-plan'

const { activePlan } = useActivePlan()
</script>
