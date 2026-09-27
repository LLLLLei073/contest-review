<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api, fullDate } from '../api';
import type { AtcoderReport } from '../../shared/atcoder';
const props = defineProps<{ contestId: string }>();
const emit = defineEmits<{ updated: [] }>();
const report = ref<AtcoderReport | null>(null),
  error = ref(''),
  busy = ref(false);
let requestNumber = 0;
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
  const current = ++requestNumber;
  busy.value = true;
  error.value = '';
  try {
    const next = await api<AtcoderReport>(
      `/atcoder/contests/${encodeURIComponent(props.contestId)}/analysis${refresh ? '/refresh' : ''}`,
      refresh ? {} : undefined,
    );
    if (current !== requestNumber) return;
    report.value = next;
    if (refresh) emit('updated');
  } catch (e) {
    if (current === requestNumber) error.value = (e as Error).message;
  } finally {
    if (current === requestNumber) busy.value = false;
  }
}
onMounted(() => load());
watch(
  () => props.contestId,
  () => {
    report.value = null;
    void load();
  },
);
</script>
<template>
  <div class="report-body">
    <div class="alert">
      官方成绩来自 AtCoder
      公开历史；时间线与建议仅依据已同步的赛时提交和当前判定。没有官方记录时，赛时提交不能证明参赛身份。
    </div>
    <p v-if="error" class="alert error">{{ error }}<button @click="load()">重试</button></p>
    <div v-if="report">
      <div v-if="report.official" class="panel settings-card">
        <h3>AtCoder 官方成绩</h3>
        <div class="metrics">
          <div class="metric">
            <span>官方排名</span><strong>#{{ report.official.place }}</strong>
          </div>
          <div class="metric">
            <span>官方 Performance</span><strong>{{ report.official.performance ?? '暂无数据' }}</strong>
          </div>
          <div class="metric">
            <span>Rating</span
            ><strong
              >{{ report.official.oldRating ?? '暂无数据' }} →
              {{ report.official.newRating ?? '暂无数据' }}</strong
            >
          </div>
        </div>
        <p class="small subtle">
          {{ report.official.rated ? '评级场次' : '非评级场次' }} · 历史更新于
          {{ fullDate(report.official.fetchedAt) }} ·
          <a :href="report.official.sourceUrl" target="_blank" rel="noreferrer">查看官方历史</a>
        </p>
      </div>
      <p v-else class="small subtle">暂无可匹配的官方参赛记录；参赛身份保持未核实。</p>
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
          report.complete ? '完整提交历史已同步' : '提交历史尚未完整同步，分析暂定'
        }}。当前判定可能包含重判，无法还原赛时评测过程。
      </p>
      <p v-if="!report.windowAvailable" class="alert">比赛时间资料待补齐，暂不将提交划分为赛时或赛后。</p>
      <h3>赛时分题时间线</h3>
      <div v-if="!report.inContest.length" class="quiet-empty">
        {{ report.official ? '官方参赛记录已确认；没有已同步的赛时提交。' : '没有已同步的赛时提交。' }}
      </div>
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
      <p v-if="report.unclassified?.length" class="small subtle">
        另有 {{ report.unclassified.length }} 次提交因比赛时间缺失而暂未分类。
      </p>
    </div>
    <button class="small-button" :disabled="busy" @click="load(true)">
      {{ busy ? '正在更新…' : '刷新分析' }}
    </button>
  </div>
</template>
