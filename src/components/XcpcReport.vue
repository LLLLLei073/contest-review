<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { RefreshCw, ArrowUpRight } from 'lucide-vue-next';
import { api } from '../api';
import type { XcpcHistory, XcpcReport } from '../../shared/xcpc';
const props = defineProps<{ slug: string }>();
const emit = defineEmits<{ updated: [] }>();
type Response = {
  history: XcpcHistory;
  report: XcpcReport | null;
  mode: 'official' | 'all';
  task: { status: string; message: string };
};
const data = ref<Response | null>(null),
  error = ref(''),
  busy = ref(false);
const team = computed(() =>
  data.value?.report?.detail.teams.find((t) =>
    t.members.some((m) => m.key === data.value?.report?.playerKey),
  ),
);
let alive = true,
  timer: ReturnType<typeof setTimeout> | undefined;
async function read(auto = false) {
  try {
    const next = await api<Response>(`/xcpc/contests/${encodeURIComponent(props.slug)}/analysis`);
    if (!alive) return;
    const wasRunning = data.value?.task.status === 'running';
    data.value = next;
    if (next.task.status === 'running') timer = setTimeout(() => void read(), 1200);
    else if (wasRunning) emit('updated');
    if (auto && !next.report && next.task.status === 'idle' && navigator.onLine) await refresh();
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  }
}
async function refresh() {
  busy.value = true;
  error.value = '';
  clearTimeout(timer);
  try {
    data.value = await api<Response>(`/xcpc/contests/${encodeURIComponent(props.slug)}/analysis/refresh`, {});
    timer = setTimeout(() => void read(), 1100);
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(() => void read(true));
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(timer);
});
</script>
<template>
  <section class="auto-report" aria-label="XCPC 比赛报告">
    <div class="report-toolbar">
      <h3>XCPC 来源报告</h3>
      <button class="secondary" :disabled="busy || data?.task.status === 'running'" @click="refresh">
        <RefreshCw :size="15" />{{ data?.task.status === 'running' ? '获取中…' : '刷新来源数据' }}
      </button>
    </div>
    <p class="small subtle">
      表现分来自 XCPC Rating 的队伍成绩，不是本站 Codeforces 百分制综合分。仅正式口径会隐藏打星参赛的表现分。
    </p>
    <p v-if="data?.report" class="small subtle">
      报告更新：{{ new Date(data.report.fetchedAt).toLocaleString('zh-CN') }} ·
      <a :href="data.report.sourceUrl" target="_blank" rel="noopener noreferrer"
        >查看数据来源 <ArrowUpRight :size="13"
      /></a>
    </p>
    <p v-if="data?.task.message" :class="['alert', { error: data.task.status === 'failed' }]">
      {{ data.task.message }}
    </p>
    <p v-if="error" class="alert error">{{ error }}</p>
    <template v-if="data">
      <div class="report-score">
        <div>
          <span class="eyebrow">XCPC / {{ data.mode === 'official' ? '仅正式' : '所有参赛' }}口径</span>
          <div class="score-value">
            {{
              data.mode === 'official'
                ? data.history.official && data.history.ratedOfficial
                  ? (data.history.perfOfficial ?? '—')
                  : '—'
                : data.history.rated
                  ? (data.history.perf ?? '—')
                  : '—'
            }}
          </div>
          <strong>来源表现分</strong>
        </div>
        <div class="score-facts">
          <span
            >队伍 <b>{{ data.history.teamName }}</b></span
          ><span
            >排名
            <b
              >#{{
                data.mode === 'official'
                  ? (data.history.rankOfficial ?? data.history.rank)
                  : data.history.rank
              }}</b
            >
            /
            {{
              data.mode === 'official'
                ? (data.history.teamCountOfficial ?? data.history.teamCount)
                : data.history.teamCount
            }}</span
          ><span
            >完成 <b>{{ data.history.solved ?? '—' }}</b> 题</span
          >
        </div>
      </div>
      <p v-if="!data.history.official && data.mode === 'official'" class="alert">
        本场为打星 / 非正式参赛；仅正式口径不提供表现分。可切换到“所有参赛”查看来源分数。
      </p>
      <p v-else-if="!data.history.rated" class="alert">来源将本场标为不计分比赛，因此没有表现分。</p>
      <div v-if="data.report" class="report-context">
        <strong>队伍成绩与公开数据</strong>
        <p>
          {{ data.report.detail.category }} · {{ data.report.detail.tier }} ·
          {{ data.report.detail.teamCount }} 支队伍
        </p>
        <p v-if="team">
          罚时 {{ team.penalty }} · 完成 {{ team.solved }} 题 · {{ team.official ? '正式参赛' : '打星参赛' }}
        </p>
        <p class="small subtle">
          来源提供队伍汇总和题目统计，没有完整的个人提交日志；这里不推测逐题做题顺序或失败次数。
        </p>
      </div>
      <template v-if="data.report?.detail.problems?.length">
        <h3>本场题目与全场统计</h3>
        <article v-for="p in data.report.detail.problems" :key="p.alias" class="timeline-problem">
          <div class="report-toolbar">
            <a v-if="p.problemUrl" :href="p.problemUrl" target="_blank" rel="noopener noreferrer"
              ><strong>{{ p.alias }} · {{ p.title || '未命名题目' }}</strong
              ><ArrowUpRight :size="13" /></a
            ><strong v-else>{{ p.alias }} · {{ p.title || '未命名题目' }}</strong
            ><span class="small subtle">{{
              p.problemRating == null ? '难度未知' : Math.round(p.problemRating)
            }}</span>
          </div>
          <p class="small subtle">
            全场通过 {{ p.accepted ?? '—' }} / 提交 {{ p.submitted ?? '—' }} ·
            {{ p.typeLabels?.join('、') || '标签待补全' }}。这些是全场统计，不代表该队逐题提交。
          </p>
        </article>
      </template>
      <h3>下一场的行动建议</h3>
      <p v-if="!data.report?.advice.length" class="subtle">暂无足够证据生成具体建议。</p>
      <article v-for="(a, i) in data.report?.advice" :key="i" class="advice-card">
        <span class="eyebrow">{{ String(i + 1).padStart(2, '0') }} / ACTION</span>
        <p>
          <strong>{{ a.evidence }}</strong>
        </p>
        <p class="subtle">{{ a.issue }}</p>
        <p>{{ a.action }}</p>
      </article>
    </template>
  </section>
</template>
