import { computed, ref } from 'vue'

import { listRows, subscribeRows } from '@/data/local-store'
import {
  planVersions,
  subscribePlanVersions,
} from '@/data/plan-versions'
import {
  FIELD_PLAN_CODE,
  FIELD_PLAN_NAME,
  isPlanApproved,
  effectiveVersion,
  type PlanVersion,
} from '@/data/plan-domain'
import type { EntryRow } from '@/data/types'

// 其余页面（巡检记录页、全局横幅）读取巡检清单都走这里：
// 清单永远取自方案的同一个有效版本，不存在各页面各读一份的情况。

const tick = ref(0)

subscribePlanVersions(() => {
  tick.value += 1
})
// 方案批准/废止会改业务数据，版本清单也必须随之重算
subscribeRows(() => {
  tick.value += 1
})

export type ActivePlanContext = {
  planId: number
  planCode: string
  planName: string
  version: PlanVersion
  checklist: string[]
}

function pickActive(): ActivePlanContext | null {
  void tick.value
  const plans = listRows('plan')
  const versions = planVersions()
  const candidates: { plan: EntryRow; version: PlanVersion }[] = []
  for (const plan of plans) {
    if (!isPlanApproved(plan)) {
      continue
    }
    const version = effectiveVersion(versions, plan.id)
    if (version) {
      candidates.push({ plan, version })
    }
  }
  // 同一批数据里可能有多个批准方案，取版本批准时间最新的一个作为当前执行版本
  const picked = candidates.sort((a, b) =>
    a.version.approvedAt < b.version.approvedAt ? 1 : -1,
  )[0]
  if (!picked) {
    return null
  }
  return {
    planId: picked.plan.id,
    planCode: String(picked.plan[FIELD_PLAN_CODE] ?? ''),
    planName: String(picked.plan[FIELD_PLAN_NAME] ?? ''),
    version: picked.version,
    checklist: picked.version.checklist,
  }
}

export function useActivePlan() {
  const activePlan = computed<ActivePlanContext | null>(() => {
    void tick.value
    return pickActive()
  })
  return { activePlan }
}
