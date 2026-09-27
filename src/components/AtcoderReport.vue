<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, fullDate } from '../api';
import type { AtcoderReport } from '../../shared/atcoder';
const props = defineProps<{ contestId: string }>();
const report = ref<AtcoderReport | null>(null),
  error = ref(''),
  busy = ref(false);
const problemRows = computed(() => {
  const map = new Map<string, AtcoderReport['inContest']>();
  for (const item of report.value?.inContest ?? [])
    map.set(item.problemKey, [...(map.get(item.problemKey) ?? []), item]);
  return [...map].map(([key, items]) => ({
    key,
    first: items[0].time,
    firstAc: items.find((s) => s.verdict === 'OK')?.time ?? null,
    failures: items.filter((s) =>
      [
        'WRONG_ANSWER',
        'TIME_LIMIT_EXCEEDED',
        'MEMORY_LIMIT_EXCEEDED',
        'RUNTIME_ERROR',
        'COMPILATION_ERROR',
        'OUTPUT_LIMIT_EXCEEDED',
      ].includes(s.verdict),
    ).length,
    items,
  }));
});
async function load(refresh = false) {
  busy.value = true;
  error.value = '';
  try {
    report.value = await api<AtcoderReport>(
      `/atcoder/contests/${encodeURIComponent(props.contestId)}/analysis${refresh ? '/refresh' : ''}`,
      refresh ? {} : undefined,
    );
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => load());
watch(
  () => props.contestId,
  () => load(),
);
</script>
<template>
  <div class="report-body">
    <div class="alert">
      仅根据赛时提交时间与当前判定生成事实分析；无法核实正式或虚拟参赛身份，不提供官方排名、表现分或综合分。
    </div>
    <p v-if="error" class="alert error">{{ error }}<button @click="load()">重试</button></p>
    <div v-if="report">
      <div class="metrics">
        <div class="metric">
          <span>赛时 AC</span><strong>{{ report.solved }}</strong>
        </div>
        <div class="metric">
          <span>赛时失败</span><strong>{{ report.failures }}</strong>
        </div>
        <div class="metric">
          <span>首次 AC</span
          ><strong>{{ report.firstAcMinutes === null ? '—' : report.firstAcMinutes + ' 分钟' }}</strong>
        </div>
      </div>
      <p class="small subtle">
        来源：AtCoder Problems · 更新于 {{ fullDate(report.fetchedAt) }} ·
        {{
          report.complete ? '完整历史已同步' : '历史尚未完整同步，分析暂定'
        }}。当前判定可能包含重判，无法还原赛时评测过程。
      </p>
      <h3>赛时分题时间线</h3>
      <div v-if="!report.inContest.length" class="quiet-empty">无赛时提交，不视为参赛。</div>
      <div v-for="row in problemRows" :key="row.key" class="panel settings-card">
        <h4>{{ row.key.slice(8) }}</h4>
        <p class="small subtle">
          首次提交 {{ fullDate(new Date(row.first * 1000).toISOString()) }} · 首次 AC
          {{ row.firstAc === null ? '—' : fullDate(new Date(row.firstAc * 1000).toISOString()) }} · 失败
          {{ row.failures }} 次
        </p>
        <div v-for="item in row.items" :key="item.id" class="timeline-item">
          <a :href="item.url" target="_blank" rel="noreferrer">{{ item.verdict }} · #{{ item.id }}</a
          ><span class="subtle">{{ fullDate(new Date(item.time * 1000).toISOString()) }}</span>
        </div>
      </div>
      <h3>有证据的下一步</h3>
      <div v-if="!report.advice.length" class="quiet-empty">暂无需要特别提醒的失误。</div>
      <p v-for="(item, i) in report.advice" :key="i">{{ item.evidence }} → {{ item.action }}</p>
      <details v-if="report.afterContest.length">
        <summary>赛后补题 {{ report.afterContest.length }} 次（不计入赛时）</summary>
        <div v-for="item in report.afterContest" :key="item.id" class="timeline-item">
          <a :href="item.url" target="_blank" rel="noreferrer"
            >{{ item.problemKey.slice(8) }} · {{ item.verdict }}</a
          >
        </div>
      </details>
    </div>
    <button class="small-button" :disabled="busy" @click="load(true)">
      {{ busy ? '正在更新…' : '刷新分析' }}
    </button>
  </div>
</template>
