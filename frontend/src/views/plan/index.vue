<template>
  <section class="page" data-module="plan">
    <header class="page-head">
      <div>
        <h2>测报方案管理</h2>
        <p class="page-desc">维护测报方案，围绕方案编号、方案名称、适用范围、监测项目做登记、筛选、版本归档与上线前检查。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测报方案</button>
        <button class="btn" type="button" @click="runMigration">执行示例数据迁移</button>
        <button class="btn" type="button" @click="runPreflight">上线前检查</button>
        <button class="btn" type="button" @click="exportRows">导出测报方案清单</button>
      </div>
    </header>

    <div v-if="migrationMessage" class="preflight-panel">
      <strong>示例数据迁移：</strong>{{ migrationMessage }}
    </div>

    <div v-if="preflight" class="preflight-panel" data-role="preflight-panel">
      <div>
        <strong>上线前检查报告</strong>
        <span class="banner-time">批次 {{ preflight.batchId }} · 生成于 {{ preflight.takenAt }}</span>
        <span>（方案状态、站房维护待办、巡检清单使用同一批数据核对）</span>
      </div>
      <div>已批准方案 {{ preflight.summary.approvedPlans }} · 待审批 {{ preflight.summary.pendingApprovals }} · 站房维护待办 {{ preflight.summary.stationhouseTodos }} · 巡检待办 {{ preflight.summary.inspectionTodos }}</div>
      <p v-if="!preflight.issues.length" class="preflight-ok">全部核对通过，可以上线。</p>
      <p
        v-for="(issue, index) in preflight.issues"
        :key="index"
        class="preflight-issue"
        :class="issue.level"
      >
        [{{ issue.section }}·{{ issue.level === 'error' ? '阻断' : '提醒' }}] {{ issue.message }}
      </p>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>版本号</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span
              v-if="versionOf(row)"
              class="version-tag"
              :class="{ archived: versionOf(row)?.archived }"
            >
              {{ versionOf(row)?.versionNo }}{{ versionOf(row)?.archived ? '（已归档）' : '' }}
            </span>
            <span v-else>—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无测报方案数据，可先登记测报方案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条测报方案记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as genericAction,
} from '@/api/local-service'
import {
  archivePlan,
  approvePlan,
  planActionAvailability,
  revokePlan,
} from '@/api/plan-service'
import {
  ensurePlanMigrated,
  planVersions,
  runPlanMigration,
} from '@/data/plan-versions'
import {
  effectiveVersion,
  isPlanPendingApproval,
  type PlanVersion,
} from '@/data/plan-domain'
import {
  preflightBlockingErrors,
  runPreflight as executePreflight,
  type PreflightReport,
} from '@/data/plan-preflight'
import { allRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('plan')
const columns = meta.fields
const actionList = ['提交审批', '批准方案', '废止方案', '归档']
const statuses = meta.statuses
const stats = ref(meta.metrics.map((label) => ({ label, value: 0 })))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const migrationMessage = ref('')
const preflight = ref<PreflightReport | null>(null)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const versions = ref<PlanVersion[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function availability(row: EntryRow): Record<string, boolean> {
  return planActionAvailability(row)
}

function availableActions(row: EntryRow): string[] {
  const map = availability(row)
  return actionList.filter((action) => map[action])
}

function versionOf(row: EntryRow): PlanVersion | undefined {
  const own = versions.value
    .filter((version) => version.planId === row.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return effectiveVersion(versions.value, row.id) ?? own[0]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '测报方案登记入口尚未接入审批流'
}

// 页面的动作可见性、版本检查、归档入口共用 plan-domain 的同一套判断
function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  let result
  if (action === '批准方案') {
    result = approvePlan(Number(row.id))
  } else if (action === '废止方案') {
    result = revokePlan(Number(row.id))
  } else if (action === '归档') {
    result = archivePlan(Number(row.id))
  } else {
    result = genericAction(meta.key, Number(row.id), action)
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

// 迁移中断后从未处理方案继续；重复执行不会产生第二个有效版本
function runMigration() {
  errorMessage.value = ''
  const output = runPlanMigration()
  const versioned = output.processed.filter((step) => step.status === 'versioned')
  const blocked = output.processed.filter((step) => step.status === 'blocked')
  if (blocked.length > 0) {
    migrationMessage.value = `迁移在方案 ${blocked.map((step) => step.planId).join('、')} 处中断：${blocked[0].reason ?? ''}，修复批准时间后再次执行将从该方案继续。`
    errorMessage.value = migrationMessage.value
  } else if (output.done) {
    migrationMessage.value = `迁移完成，本次新增版本 ${versioned.length} 个，已有版本保持不变。`
  } else {
    migrationMessage.value = `本次处理 ${output.processed.length} 条方案，可继续执行直至完成。`
  }
  reload()
}

// 上线前检查：方案状态、站房维护待办、巡检清单核对同一批数据
function runPreflight() {
  errorMessage.value = ''
  versions.value = planVersions()
  preflight.value = executePreflight(allRows(), versions.value)
  const blocking = preflightBlockingErrors(preflight.value)
  if (blocking.length > 0) {
    errorMessage.value = `检查发现 ${blocking.length} 个阻断问题，暂不满足上线条件（批次 ${preflight.value.batchId}）`
  }
}

function reload() {
  errorMessage.value = ''
  try {
    ensurePlanMigrated()
    versions.value = planVersions()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: '方案总数', value: payload.total },
      { label: '已批准方案', value: payload.items.filter((row) => ['已批准', '已修订'].includes(String(row.status))).length },
      { label: '待审批方案', value: payload.items.filter((row) => isPlanPendingApproval(row)).length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测报方案列表读取失败'
  }
}

onMounted(reload)
</script>
