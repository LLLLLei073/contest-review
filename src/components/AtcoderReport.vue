<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowUpRight, RefreshCw } from 'lucide-vue-next';
import { api, fullDate } from '../api';
import type { AtcoderReport } from '../../shared/atcoder';
const props = defineProps<{ contestId: string }>();
const emit = defineEmits<{ updated: []; ready: [contestId: string] }>();
const report = ref<AtcoderReport | null>(null),
  error = ref(''),
  busy = ref(false);
let requestNumber = 0;
let initialReadSettled = false;
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
    if (!initialReadSettled) {
      initialReadSettled = true;
      emit('ready', props.contestId);
    }
    if (refresh) emit('updated');
  } catch (e) {
    if (current === requestNumber) error.value = (e as Error).message;
  } finally {
    if (current === requestNumber) busy.value = false;
    if (current === requestNumber && !initialReadSettled) {
      initialReadSettled = true;
      emit('ready', props.contestId);
    }
  }
}
onMounted(() => load());
onBeforeUnmount(() => {
  requestNumber++;
});
watch(
  () => props.contestId,
  () => {
    initialReadSettled = false;
    report.value = null;
    void load();
  },
);
</script>
<template>
  <section class="auto-report" aria-label="AtCoder 比赛报告">
    <div class="report-toolbar">
      <h3>AtCoder 比赛分析</h3>
      <button class="secondary" :disabled="busy" @click="load(true)">
        <RefreshCw :size="15" />{{ busy ? '正在更新…' : '刷新分析' }}
      </button>
    </div>
    <p class="small subtle">
      官方排名、Performance 和 Rating 来自 AtCoder 公开历史；赛时数据与建议仅依据已同步提交的当前判定。
    </p>
    <p v-if="error" class="alert error" role="status">
      {{ error }} <button class="small-button" @click="load()">重试</button>
    </p>
    <template v-if="report">
      <p class="small subtle">
        报告更新：{{ fullDate(report.fetchedAt) }} ·
        {{
          report.complete ? '完整提交历史已同步' : '提交历史尚未完整同步，分析暂定'
        }}。重判后无法还原赛时评测过程。
      </p>
      <div class="report-score">
        <div>
          <span class="eyebrow">ATCODER / OFFICIAL PERFORMANCE</span>
          <div class="score-value">{{ report.official?.performance ?? '—' }}</div>
          <strong>AtCoder 官方 Performance</strong>
          <p v-if="report.official?.performance == null" class="performance-method">
            {{
              !report.official
                ? '尚无可匹配的官方参赛记录'
                : report.official.rated
                  ? '官方历史暂未提供 Performance'
                  : '非评级场次，官方历史未提供 Performance'
            }}
          </p>
          <p v-else class="performance-method">AtCoder 来源值，非本站综合复盘分</p>
        </div>
        <div class="score-facts">
          <span
            >赛时 AC <b>{{ report.solved }}</b> 题</span
          >
          <span
            >赛时失败 <b>{{ report.failures }}</b> 次</span
          >
          <span
            >首次 AC <b>{{ report.firstAcMinutes === null ? '—' : report.firstAcMinutes + ' 分钟' }}</b></span
          >
        </div>
      </div>
      <div class="report-context">
        <strong>官方成绩与数据来源</strong>
        <template v-if="report.official">
          <p>
            官方排名 {{ report.official.place == null ? '暂无数据' : '#' + report.official.place }} ·
            {{ report.official.rated ? '评级场次' : '非评级场次' }}
          </p>
          <p>
            Rating：{{ report.official.oldRating ?? '暂无数据' }} →
            {{ report.official.newRating ?? '暂无数据' }}
          </p>
          <p class="small subtle">
            官方历史更新：{{ fullDate(report.official.fetchedAt) }} ·
            <a :href="report.official.sourceUrl" target="_blank" rel="noopener noreferrer"
              >查看官方历史 <ArrowUpRight :size="13"
            /></a>
          </p>
        </template>
        <p v-else>暂无可匹配的官方参赛记录；赛时提交不能证明正式参赛身份。</p>
        <p class="small subtle">提交来源：AtCoder Problems · {{ fullDate(report.fetchedAt) }}</p>
      </div>
      <p v-if="!report.windowAvailable" class="alert">比赛时间资料待补齐，暂不将提交划分为赛时或赛后。</p>
      <details class="report-deep-dive">
        <summary>赛时分题时间线 · {{ problemRows.length }} 题</summary>
        <p class="small subtle">时间按提交记录展示；提交间隔不等于思考时长。</p>
        <p v-if="!report.inContest.length" class="quiet-empty">
          {{ report.official ? '官方参赛记录已确认；没有已同步的赛时提交。' : '没有已同步的赛时提交。' }}
        </p>
        <article
          v-for="(row, index) in problemRows"
          :key="row.key"
          class="timeline-problem"
          :style="{ '--motion-index': Math.min(index, 5) }"
        >
          <div class="report-toolbar">
            <a
              :href="`https://atcoder.jp/contests/${contestId}/tasks/${row.key.slice(8)}`"
              target="_blank"
              rel="noopener noreferrer"
              ><strong>{{ row.key.slice(8) }}</strong> <ArrowUpRight :size="13"
            /></a>
            <span class="small subtle">失败 {{ row.failures }} 次</span>
          </div>
          <p class="small subtle">
            首次提交 {{ fullDate(new Date(row.first * 1000).toISOString()) }} · 首次 AC
            {{ row.firstAc === null ? '—' : fullDate(new Date(row.firstAc * 1000).toISOString()) }}
          </p>
          <ol class="submission-timeline">
            <li v-for="item in row.items" :key="item.id">
              <a
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                :class="{
                  accepted: item.verdict === 'OK',
                  failed: [
                    'WRONG_ANSWER',
                    'TIME_LIMIT_EXCEEDED',
                    'MEMORY_LIMIT_EXCEEDED',
                    'RUNTIME_ERROR',
                    'COMPILATION_ERROR',
                    'OUTPUT_LIMIT_EXCEEDED',
                  ].includes(item.verdict),
                }"
                >{{ fullDate(new Date(item.time * 1000).toISOString()) }} · {{ item.verdict }}
                <small>#{{ item.id }}</small></a
              >
            </li>
          </ol>
        </article>
      </details>
      <h3>下一场的行动建议</h3>
      <p v-if="!report.advice.length" class="subtle">目前没有足够证据触发具体建议。</p>
      <article v-for="(item, i) in report.advice" :key="i" class="advice-card">
        <span class="eyebrow">{{ String(i + 1).padStart(2, '0') }} / ACTION</span>
        <p>
          <strong>{{ item.evidence }}</strong>
        </p>
        <p>{{ item.action }}</p>
      </article>
      <details v-if="report.afterContest.length" class="report-context">
        <summary>赛后补题 {{ report.afterContest.length }} 次（不计入赛时）</summary>
        <ol class="submission-timeline">
          <li v-for="item in report.afterContest" :key="item.id">
            <a :href="item.url" target="_blank" rel="noopener noreferrer"
              >{{ item.problemKey.slice(8) }} · {{ item.verdict }} <small>#{{ item.id }}</small></a
            >
          </li>
        </ol>
      </details>
      <p v-if="report.unclassified?.length" class="small subtle">
        另有 {{ report.unclassified.length }} 次提交因比赛时间缺失而暂未分类。
      </p>
    </template>
  </section>
</template>
