<template>
  <section class="page" data-module="plan">
    <header class="page-head">
      <div>
        <h2>测报方案管理</h2>
        <p class="page-desc">
          维护测报方案，围绕方案编号、方案名称、适用范围、监测项目做登记、筛选与状态流转；
          版本检查、归档与页面动作共用同一套判断与版本库。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测报方案</button>
        <button class="btn" type="button" @click="runPreflight">上线前检查</button>
        <button class="btn" type="button" @click="archiveAll">归档废止方案</button>
        <button class="btn" type="button" @click="exportRows">导出测报方案清单</button>
      </div>
    </header>

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

    <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>

    <section v-if="report" class="preflight-panel" :class="{ failed: !report.ok }">
      <header class="preflight-head">
        <strong>上线前检查（{{ report.snapshotLabel }}）</strong>
        <span :class="['badge', report.ok ? 'ok' : 'bad']">{{ report.ok ? '通过' : '不通过' }}</span>
      </header>
      <p class="page-desc">
        方案状态、站房维护待办、巡检清单基于同一份数据快照核对：
        方案 {{ report.planCount }} 条 / 版本 {{ report.versionCount }} 个 / 有效版本 {{ report.effectiveCount }} 个
      </p>
      <ul v-if="report.issues.length" class="issue-list">
        <li v-for="(issueItem, index) in report.issues" :key="index" :class="['issue', issueItem.level]">
          <span class="issue-level">{{ levelText(issueItem.level) }}</span>
          <span class="issue-code">{{ issueItem.code }}</span>
          <span>{{ issueItem.message }}</span>
        </li>
      </ul>
      <p v-else class="issue-empty">三类核对全部一致，方案版本、站房待办与巡检清单使用同一批数据。</p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>方案状态</span>
        <select v-model="statusFilter">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
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
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ versionLabel(row) }}</td>
          <td>
            <span :class="['status-badge', phaseOfStatus(String(row.status))]">{{ row.status }}</span>
            <span v-if="isArchived(row)" class="badge archived">已归档</span>
          </td>
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
} from '@/api/local-service'
import {
  archiveRepealedPlans,
  executePlanAction,
  planStore,
} from '@/data/plan/store'
import { availableActions, phaseOfStatus } from '@/data/plan/policy'
import { PLAN_STATUS_SEQUENCE } from '@/data/plan/types'
import type { EntryRow } from '@/data/types'
import type { PlanPreflightReport } from '@/data/plan/types'

const meta = moduleMeta('plan')
// 列与模块元数据对齐（去掉业务上冗余的末位「方案状态」文案列，状态在专属列渲染）。
const columns = ['方案编号', '方案名称', '适用范围', '监测项目', '测次安排', '编制人', '批准人', '批准时间']
const statuses = [...PLAN_STATUS_SEQUENCE]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const statusFilter = ref('')
const filterFields = columns.slice(0, 3)
const report = ref<PlanPreflightReport | null>(null)

const stats = computed(() => {
  const approved = rows.value.filter((row) => phaseOfStatus(String(row.status)) === 'effective').length
  const pending = rows.value.filter((row) => phaseOfStatus(String(row.status)) === 'pending').length
  const archived = planStore().get().versions.filter((version) => !version.effective).length
  return [
    { label: '方案总数', value: total.value },
    { label: '现行有效方案', value: approved },
    { label: '待审批方案', value: pending },
    { label: '归档版本', value: archived },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  statusFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '测报方案登记入口尚未接入审批流'
}

function isArchived(row: EntryRow): boolean {
  return planStore().isArchived(Number(row.id))
}

function versionLabel(row: EntryRow): string {
  const version = planStore().get().versions.find((item) => item.planId === Number(row.id))
  if (!version) return '—'
  return version.effective ? version.versionCode : `${version.versionCode}（已归档）`
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = executePlanAction(row, action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
  if (report.value) runPreflight()
}

function archiveAll() {
  errorMessage.value = ''
  const result = archiveRepealedPlans()
  noticeMessage.value = result.message
  reload()
  if (report.value) runPreflight()
}

function runPreflight() {
  errorMessage.value = ''
  report.value = planStore().preflight('上线前检查快照')
}

function levelText(level: string): string {
  return level === 'error' ? '错误' : level === 'warning' ? '警告' : '提示'
}

function reload() {
  errorMessage.value = ''
  try {
    const scoped = listEntries(meta.key, filters.value).items.filter(
      (row) => !statusFilter.value || String(row.status) === statusFilter.value,
    )
    rows.value = scoped
    total.value = scoped.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测报方案列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.status-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  background: #eef2f7;
}
.status-badge.effective { background: #dcfce7; color: #166534; }
.status-badge.pending { background: #fef3c7; color: #92400e; }
.status-badge.draft { background: #eef2f7; color: #475569; }
.status-badge.archived { background: #fee2e2; color: #991b1b; }
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
}
.badge.archived { background: #e2e8f0; color: #334155; }
.preflight-panel {
  border: 1px solid #bbf7d0;
  background: #f0fdf4;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.preflight-panel.failed { border-color: #fecaca; background: #fef2f2; }
.preflight-head { display: flex; justify-content: space-between; align-items: center; }
.badge.ok { background: #16a34a; color: #fff; }
.badge.bad { background: #dc2626; color: #fff; }
.issue-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.issue { font-size: 13px; display: flex; gap: 8px; }
.issue.error .issue-level { color: #b91c1c; font-weight: 600; }
.issue.warning .issue-level { color: #b45309; font-weight: 600; }
.issue-code { color: var(--muted); font-family: monospace; }
.issue-empty { font-size: 13px; color: #166534; margin: 8px 0 0; }
.filter-item select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
}
.notice-text {
  margin: 0 0 10px;
  font-size: 13px;
  color: #166534;
}
</style>
