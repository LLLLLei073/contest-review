<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { api, settings, dataRevision, battleStatusLabels } from '../api';
import type { InsightsPayload } from '../../shared/insights';
const insights = ref<InsightsPayload>();
const error = ref('');
let serial = 0;
const battleStatus = (s: string) => battleStatusLabels[s] ?? s;
async function load() {
  const token = ++serial;
  insights.value = undefined;
  try {
    const data = await api<InsightsPayload>('/insights');
    if (token === serial) insights.value = data;
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  }
}
watch(() => [settings.value.activeHandle, dataRevision.value], load, { immediate: true });
onBeforeUnmount(() => {
  serial++;
});
</script>
<template>
  <p v-if="error" role="alert">{{ error }} <button @click="load">重试</button></p>
  <section v-if="insights?.battles.total" class="panel insight-panel" aria-label="连战记录">
    <div class="section-head">
      <h2>连战记录</h2>
      <RouterLink to="/battle" class="text-link">进入连战 →</RouterLink>
    </div>
    <div class="metrics insight-metrics battle-metrics">
      <div class="metric">
        <small>连战场次</small>
        <strong>{{ insights.battles.total }}</strong>
      </div>
      <div class="metric">
        <small>连战题目</small>
        <strong>{{ insights.battles.totalProblems }}</strong>
      </div>
      <div class="metric">
        <small>连战 AC</small>
        <strong>{{ insights.battles.solvedProblems }}</strong>
      </div>
      <div class="metric">
        <small>累计耗时</small>
        <strong>{{ insights.battles.totalMinutes }} 分</strong>
      </div>
    </div>
    <ol class="battle-briefs">
      <li v-for="b in insights.battles.recent" :key="b.id">
        <div class="battle-brief-head">
          <strong>{{ b.theme }}</strong>
          <span class="badge">{{ battleStatus(b.status) }}</span>
        </div>
        <p class="small subtle">
          {{ new Date(b.startedAt).toLocaleDateString() }} · {{ b.durationMinutes }} 分钟 ·
          {{ b.problemCount }} 题 / AC {{ b.solvedCount }}
        </p>
        <p v-if="b.summaryText" class="battle-brief-summary">{{ b.summaryText }}</p>
      </li>
    </ol>
  </section>
  <p v-else-if="insights" class="quiet-empty">暂无连战记录。</p>
  <p class="small subtle">来源：当前 Codeforces 账号全部连战记录。耗时沿用连战记录口径。</p>
</template>
<style scoped>
.insight-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.battle-briefs {
  padding-left: 22px;
}
.battle-briefs li {
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.battle-brief-head {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
@media (max-width: 650px) {
  .insight-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
