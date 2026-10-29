<script setup lang="ts">
import { computed } from 'vue';
import { RefreshCw, ArrowUpRight, ImageDown } from 'lucide-vue-next';
import { fullDate, unixDay } from '../api';
import type { XcpcHistory, XcpcReport } from '../../shared/xcpc';
import { useAnalysisPolling } from '../composables/useAnalysisPolling';
import { useContestCard } from '../composables/useContestCard';
const props = defineProps<{
  slug: string;
  contest?: { name?: string; startTimeSeconds?: number } | null;
}>();
const emit = defineEmits<{ updated: [] }>();
type Response = {
  history: XcpcHistory;
  report: XcpcReport | null;
  mode: 'official' | 'all';
  task: { status: string; message: string };
};
const {
  state: data,
  error,
  busy,
  refresh,
} = useAnalysisPolling<Response>({
  readPath: `/xcpc/contests/${encodeURIComponent(props.slug)}/analysis`,
  refreshPath: `/xcpc/contests/${encodeURIComponent(props.slug)}/analysis/refresh`,
  onUpdated: () => emit('updated'),
  shouldAutoRefresh: (next) => !next.report,
});
const { cardError, downloadCard: runCard } = useContestCard();
const team = computed(() =>
  data.value?.report?.detail.teams.find((t) =>
    t.members.some((m) => m.key === data.value?.report?.playerKey),
  ),
);
const displayedPerf = computed(() =>
  data.value
    ? data.value.mode === 'official'
      ? data.value.history.official && data.value.history.ratedOfficial
        ? data.value.history.perfOfficial
        : null
      : data.value.history.rated
        ? data.value.history.perf
        : null
    : null,
);
const displayedRank = computed(() =>
  data.value
    ? data.value.mode === 'official'
      ? (data.value.history.rankOfficial ?? data.value.history.rank)
      : data.value.history.rank
    : null,
);
const downloadCard = () =>
  runCard(
    data.value
      ? {
          platform: 'xcpc',
          title: props.contest?.name ?? `XCPC ${props.slug}`,
          dateText: props.contest?.startTimeSeconds ? unixDay(props.contest.startTimeSeconds) : '',
          typeText: data.value.report?.detail.category,
          performance:
            displayedPerf.value != null
              ? { value: displayedPerf.value, bound: null, label: 'XCPC 来源表现分' }
              : null,
          facts: [
            { label: '队伍', value: data.value.history.teamName },
            {
              label: '排名',
              value: `#${displayedRank.value ?? '—'} / ${
                data.value.mode === 'official'
                  ? (data.value.history.teamCountOfficial ?? data.value.history.teamCount)
                  : data.value.history.teamCount
              }`,
            },
            { label: '完成', value: `${data.value.history.solved ?? '—'} 题` },
            ...(team.value ? [{ label: '罚时', value: String(team.value.penalty) }] : []),
          ],
          fileName: `xcpc-${props.slug}-card.png`,
        }
      : null,
  );
</script>
<template>
  <RouterLink
    class="astra-context-link"
    :to="{ path: '/companion', query: { source: 'xcpc', contestId: props.slug } }"
    >与星澪复盘这场比赛</RouterLink
  >
  <section class="auto-report" aria-label="XCPC 比赛报告">
    <div class="report-toolbar">
      <h3>XCPC 来源报告</h3>
      <div class="report-actions">
        <button class="secondary" :disabled="busy || data?.task.status === 'running'" @click="refresh">
          <RefreshCw :size="15" />{{ data?.task.status === 'running' ? '获取中…' : '刷新来源数据' }}
        </button>
        <button class="secondary" :disabled="!data" @click="downloadCard">
          <ImageDown :size="15" />下载卡片
        </button>
      </div>
    </div>
    <p v-if="cardError" class="alert error" role="alert">{{ cardError }}</p>
    <p class="small subtle">
      表现分来自 XCPC Rating 的队伍成绩，不是本站 Codeforces 百分制综合分。仅正式口径会隐藏打星参赛的表现分。
    </p>
    <p v-if="data?.report" class="small subtle">
      报告更新：{{ fullDate(data.report.fetchedAt) }} ·
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
            {{ displayedPerf ?? '—' }}
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
      <details v-if="data.report?.detail.problems?.length" class="report-deep-dive">
        <summary>本场题目与全场统计 · {{ data.report.detail.problems.length }} 题</summary>
        <p class="alert">以下是全场题目统计，队伍成绩见上方。无法据此判断你本人完成了哪一道题。</p>
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
      </details>
    </template>
  </section>
</template>
