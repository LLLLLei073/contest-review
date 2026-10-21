<script setup lang="ts">
import { computed } from 'vue';
import type { PlanDecision } from '../../../shared/planning-domain';
const props = defineProps<{ decision: PlanDecision; busy: boolean }>();
const emit = defineEmits<{ apply: []; revert: []; replace: [key: string] }>();
const before = computed(() => [
  ...(props.decision.before?.review.map((p) => p.key) ?? []),
  ...(props.decision.before?.newKeys ?? []),
]);
const after = computed(() => props.decision.result.selected.map((c) => c.key));
const alternatives = computed(() =>
  props.decision.candidates.filter((c) => !after.value.includes(c.key)).slice(0, 5),
);
const status = { preview: '待确认', applied: '已采纳', reverted: '已撤回', expired: '已失效' };
</script>
<template>
  <section class="panel plan-preview" aria-labelledby="plan-preview-title">
    <div class="section-head">
      <div>
        <span class="eyebrow">REVIEW BEFORE APPLYING</span>
        <h2 id="plan-preview-title">{{ decision.request.date }} · 计划预览</h2>
      </div>
      <span class="badge">{{ status[decision.status] }}</span>
    </div>
    <p class="plan-budget">
      {{ decision.result.allocatedMinutes }}<small> 分钟安排</small
      ><span>
        / {{ decision.result.budget === null ? '未设时间上限' : decision.result.budget + ' 分钟预算' }}</span
      >
    </p>
    <p class="subtle">按每题估时向上取整到 5 分钟。实际耗时会因题目与状态变化，估时不代表完成承诺。</p>
    <div v-for="conflict in decision.result.conflicts" :key="conflict" class="alert error" role="alert">
      {{ conflict }}。调整预算或预约后重新预览。
    </div>
    <p v-for="warning in decision.warnings" :key="warning" class="subtle">{{ warning }}</p>
    <ol class="planned-tasks">
      <li v-for="task in decision.result.selected" :key="task.key">
        <div>
          <span class="badge"
            >{{ task.lane === 'review' ? '复习' : '新知' }}{{ task.required ? ' · 保留' : '' }}</span
          ><strong>{{ task.key }}</strong
          ><span>{{ Math.ceil(task.minutes / 5) * 5 }} 分钟</span>
        </div>
        <p>{{ task.reason }}</p>
        <div class="button-row">
          <RouterLink v-if="task.lane === 'review'" :to="'/problems/' + encodeURIComponent(task.key)"
            >查看复盘</RouterLink
          ><a
            v-else
            :href="'https://codeforces.com/problemset/problem/' + task.key.replace(':', '/')"
            target="_blank"
            rel="noreferrer"
            >查看原题</a
          ><button
            v-if="decision.status === 'preview' && !task.required"
            class="small-button"
            :disabled="busy || decision.request.excludeKeys.length >= 10"
            @click="emit('replace', task.key)"
          >
            换一道并重新校验
          </button>
        </div>
      </li>
    </ol>
    <details>
      <summary>与原计划比较</summary>
      <p v-if="!decision.before">这一天尚未生成题单。</p>
      <p>新增：{{ after.filter((k) => !before.includes(k)).join('、') || '无' }}</p>
      <p>移出：{{ before.filter((k) => !after.includes(k)).join('、') || '无' }}</p>
    </details>
    <details v-if="alternatives.length">
      <summary>其他候选与取舍</summary>
      <ul>
        <li v-for="task in alternatives" :key="task.key">
          {{ task.key }} · 预计 {{ task.minutes }} 分钟 · {{ task.reason }}
        </li>
      </ul>
      <p>候选同时受预算、每栏五题和周目标配额限制，换题会重新求解。</p>
    </details>
    <details v-if="decision.utilityWeights">
      <summary>查看效用权重与版本</summary>
      <p>
        {{ decision.utilityWeights.version }} · 基础 {{ decision.utilityWeights.base }}，知识缺口
        {{ decision.utilityWeights.gap }}，周目标 {{ decision.utilityWeights.goal }}，路径
        {{ decision.utilityWeights.path }}，后继解锁 {{ decision.utilityWeights.unlock }}，领域稀缺覆盖
        {{ decision.utilityWeights.coverage }}，适度挑战
        {{ decision.utilityWeights.challenge }}。覆盖采用候选领域稀缺度加分，并非强制每个领域都有题。
      </p>
    </details>
    <div class="plan-confirm">
      <button
        v-if="decision.status === 'preview'"
        class="primary"
        :disabled="busy || !decision.result.feasible"
        @click="emit('apply')"
      >
        确认采用此计划</button
      ><button v-if="decision.status === 'applied'" :disabled="busy" @click="emit('revert')">
        撤回此计划</button
      ><span class="small subtle">今日题单保持固定 · {{ decision.algorithm }}</span>
    </div>
  </section>
</template>
<style scoped>
.plan-preview {
  padding: 24px;
}
.plan-budget {
  font-size: 32px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  margin: 20px 0 8px;
}
.plan-budget small,
.plan-budget > span {
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.planned-tasks {
  list-style: none;
  padding: 0;
}
.planned-tasks > li {
  padding: 18px 0;
  border-top: 1px solid var(--line);
}
.planned-tasks > li > div:first-child {
  display: flex;
  align-items: center;
  gap: 12px;
}
.planned-tasks > li > div:first-child > span:last-child {
  margin-left: auto;
  font-size: 13px;
  color: var(--muted);
}
.planned-tasks p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted);
}
.plan-confirm {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 24px;
}
.plan-preview details {
  font-size: 13px;
  line-height: 1.8;
  margin: 14px 0;
}
.plan-preview details li {
  margin: 8px 0;
}
@media (max-width: 500px) {
  .plan-preview {
    padding: 18px;
  }
}
</style>
