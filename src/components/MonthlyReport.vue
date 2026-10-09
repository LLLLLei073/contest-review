<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, settings, dataRevision } from '../api';
import {
  beijingDay,
  type MonthlyAlgorithmReport,
  type MonthlyAiReport,
  type MonthlyEvidence,
  type MonthlySource,
} from '../../shared/monthly-report';

const props = defineProps<{ source: MonthlySource }>();
const month = ref(beijingDay(new Date()).slice(0, 7));
const report = ref<MonthlyAlgorithmReport | null>(null),
  ai = ref<MonthlyAiReport | null>(null);
const loading = ref(false),
  thinking = ref(false),
  error = ref(''),
  aiError = ref('');
let sequence = 0,
  aiSequence = 0,
  alive = true;
const max = computed(() => Math.max(1, ...(report.value?.days.map((d) => d.submissions) ?? [])));
const kindLabel = { official: '正式参赛', virtual: '虚拟参赛', other: '其他参赛', window: '仅赛时提交' };
const summary = computed(() =>
  report.value
    ? [
        ['尝试题数', report.value.metrics.attempted],
        ['当月通过题数', report.value.metrics.accepted],
        [report.value.firstAcceptedLabel, report.value.metrics.firstAccepted],
        ['提交量', report.value.metrics.submissions],
        ['确认比赛数', report.value.metrics.contests],
        ['活跃天数', report.value.metrics.activeDays],
      ]
    : [],
);
async function load() {
  const seq = ++sequence;
  ++aiSequence;
  loading.value = true;
  error.value = '';
  aiError.value = '';
  ai.value = null;
  thinking.value = false;
  try {
    const value = await api<MonthlyAlgorithmReport>(
      `/statistics/monthly?month=${month.value}&source=${props.source}`,
    );
    if (alive && seq === sequence) report.value = value;
  } catch (e) {
    if (alive && seq === sequence) {
      error.value = (e as Error).message;
      report.value = null;
    }
  } finally {
    if (alive && seq === sequence) loading.value = false;
  }
}
async function explain() {
  if (!report.value) return;
  const snapshot = report.value,
    seq = ++aiSequence;
  thinking.value = true;
  aiError.value = '';
  try {
    const value = await api<MonthlyAiReport>('/learning/monthly-report', {
      month: snapshot.month,
      source: snapshot.source,
      fingerprint: snapshot.fingerprint,
    });
    if (alive && seq === aiSequence && report.value?.fingerprint === value.fingerprint) ai.value = value;
  } catch (e) {
    if (alive && seq === aiSequence) aiError.value = (e as Error).message + '；规则分析仍可使用。';
  } finally {
    if (alive && seq === aiSequence) thinking.value = false;
  }
}
const evidenceFor = (ids: string[]) => report.value?.evidence.filter((e) => ids.includes(e.id)) ?? [];
const external = (e: MonthlyEvidence) => /^https:\/\//.test(e.url);
const date = (v: string) => new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
watch(
  [
    month,
    () => props.source,
    () => settings.value.activeHandle,
    () => settings.value.activeAtcoder,
    () => settings.value.xcpcPlayer?.key,
    dataRevision,
  ],
  load,
);
onMounted(() => {
  void load();
  window.addEventListener('focus', refresh);
});
function refresh() {
  void load();
}
onBeforeUnmount(() => {
  alive = false;
  ++sequence;
  ++aiSequence;
  window.removeEventListener('focus', refresh);
});
</script>
<template>
  <RouterLink class="astra-context-link" :to="{ path: '/companion', query: { month, source: props.source } }"
    >与星澪解读本月报告</RouterLink
  >
  <section class="panel monthly-report" aria-label="月度算法报告" :aria-busy="loading">
    <div class="section-head">
      <div>
        <span class="eyebrow">MONTHLY ALGORITHM REPORT</span>
        <h2 tabindex="-1">月度算法报告</h2>
        <p>按北京时间统计；当月报告截至当前，综合考量有据可查。</p>
      </div>
      <div class="button-row">
        <label
          >报告月份
          <input
            v-model="month"
            type="month"
            :max="beijingDay(new Date()).slice(0, 7)"
            aria-label="报告月份" /></label
        ><button class="small-button" :disabled="loading" @click="load">刷新报告</button>
      </div>
    </div>
    <p v-if="loading" role="status">正在读取月度报告…</p>
    <div v-if="error" role="alert" class="alert error">{{ error }}</div>
    <template v-if="report && !loading">
      <p class="small subtle">
        {{ report.month }} · {{ report.current ? '当月截至当前' : '完整月份' }} · 数据截至
        {{ date(report.endAt) }}
      </p>
      <div class="monthly-metrics">
        <article v-for="[label, value] in summary" :key="label">
          <span>{{ label }}</span
          ><strong>{{ value }}</strong>
        </article>
      </div>
      <p>
        提交：AC {{ report.metrics.ac }} · 明确失败 {{ report.metrics.failed }} · 待评测
        {{ report.metrics.pending }} · 其他 {{ report.metrics.other }}。
      </p>
      <p>
        比赛：正式 {{ report.metrics.official }} · 虚拟 {{ report.metrics.virtual }} · 其他参赛
        {{ report.metrics.otherContests }}；另有 {{ report.metrics.window }} 场仅赛时提交，未计入确认总数。
      </p>
      <p v-if="!report.metrics.submissions && !report.metrics.contests" class="quiet-empty">
        本月尚无已保存的提交或确认参赛记录。同步账号后可刷新报告。
      </p>
      <h3>与 {{ report.comparison.month }} {{ report.current ? '同期' : '完整月份' }}比较</h3>
      <p v-if="!report.comparison.hasBaseline" class="subtle">没有可用比较基准，不生成增长率。</p>
      <div v-else class="monthly-comparison">
        <span
          v-for="[key, label] in [
            ['attempted', '尝试题数'],
            ['submissions', '提交量'],
            ['contests', '比赛数'],
            ['activeDays', '活跃天数'],
          ] as const"
          :key="key"
        >
          {{ label }}：{{ (report.comparison.changes[key]?.delta ?? 0) > 0 ? '+' : ''
          }}{{ report.comparison.changes[key]?.delta }}
          <small v-if="report.comparison.changes[key]?.percent != null"
            >（{{ report.comparison.changes[key]!.percent!.toFixed(1) }}%）</small
          ><small v-else>（基准为零）</small>
        </span>
      </div>
      <h3>每日做题与提交</h3>
      <div class="monthly-days" role="list" aria-label="每日做题趋势">
        <div
          v-for="day in report.days"
          :key="day.date"
          role="listitem"
          :title="`${day.date}：尝试 ${day.attempted} 题，通过 ${day.accepted} 题，提交 ${day.submissions} 条`"
        >
          <span class="small">{{ day.date.slice(8) }}日</span>
          <div class="monthly-bar"><span :style="{ width: `${(day.submissions / max) * 100}%` }"></span></div>
          <span class="small"
            >{{ day.attempted }} 题 / {{ day.submissions }} 提交 / AC {{ day.accepted }} 题</span
          >
        </div>
      </div>
      <h3>复习、提示与迁移</h3>
      <p>
        复习完成 {{ report.metrics.reviewCompleted }} / {{ report.metrics.reviewAssigned }} 项；重做评价：独立
        {{ report.metrics.independent }}、借助提示 {{ report.metrics.hint }}、未完成
        {{ report.metrics.redoFailed }}。
      </p>
      <p>
        提示使用 {{ report.metrics.hintSessions }} 个练习会话；迁移结果：独立
        {{ report.metrics.transferIndependent }}、提示 {{ report.metrics.transferHint }}、未完成
        {{ report.metrics.transferFailed }}。各维度可能来自同一次练习，不相加计总量。
      </p>
      <h3>比赛明细与补题</h3>
      <p v-if="!report.contests.length" class="subtle">本月没有可归属的比赛记录。</p>
      <article v-for="contest in report.contests" :key="contest.key" class="monthly-contest">
        <RouterLink :to="contest.url">{{ contest.name }}</RouterLink
        ><span
          >{{ contest.source.toUpperCase() }} · {{ kindLabel[contest.kind] }} ·
          {{ date(contest.startAt) }}</span
        >
        <p v-if="contest.teamName">队伍 {{ contest.teamName }} · 仅考量队伍成绩</p>
        <p>
          解题 {{ contest.solved ?? '未知' }} · 排名 {{ contest.rank ?? '未知' }} ·
          {{ contest.scoreLabel || '已有评分' }} {{ contest.score ?? '未分析' }} · 当前补题
          {{ contest.upsolveCompleted }}/{{ contest.upsolveAssigned }}
        </p>
        <p v-if="contest.rating">
          本平台 Rating：{{ contest.rating.old ?? '未知' }} → {{ contest.rating.new ?? '未知' }} · 表现
          {{ contest.rating.bound === 'lower' ? '≥' : contest.rating.bound === 'upper' ? '≤' : ''
          }}{{ contest.rating.performance ?? '未知' }}
        </p>
      </article>
      <div class="section-head">
        <h3>综合考量与下月建议</h3>
        <button class="small-button" :disabled="thinking || loading" @click="explain">
          {{ thinking ? '正在生成 AI 解读…' : 'AI 解读' }}
        </button>
      </div>
      <p v-if="aiError" role="alert" class="alert error">{{ aiError }}</p>
      <div v-for="(findings, index) in [report.findings, ...(ai ? [ai.findings] : [])]" :key="index">
        <h4>{{ index === 0 ? '规则分析' : 'AI 解读（本次生成）' }}</h4>
        <article v-for="(finding, i) in findings" :key="i" class="monthly-finding">
          <strong>{{ finding.title }}</strong>
          <p>{{ finding.cause }}</p>
          <p>下一步：{{ finding.action }}</p>
          <details>
            <summary>查看依据（{{ finding.evidenceIds.length }}）</summary>
            <div v-for="e in evidenceFor(finding.evidenceIds)" :key="e.id">
              <p>{{ e.text }}</p>
              <a v-if="external(e)" :href="e.url" target="_blank" rel="noreferrer">打开原始记录</a
              ><RouterLink v-else-if="e.url" :to="e.url">查看关联记录</RouterLink>
            </div>
          </details>
        </article>
      </div>
      <details>
        <summary>题目与训练证据（{{ report.evidence.length }}）</summary>
        <div v-for="e in report.evidence" :key="e.id" class="monthly-evidence">
          <p>{{ e.text }}</p>
          <a v-if="external(e)" :href="e.url" target="_blank" rel="noreferrer">打开原始记录</a
          ><RouterLink v-else-if="e.url" :to="e.url">查看关联记录</RouterLink>
        </div>
      </details>
      <h3>数据完整性说明</h3>
      <ul>
        <li v-for="warning in [...new Set([...report.warnings, ...(ai?.warnings ?? [])])]" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <p v-for="item in report.completeness" :key="item.source" class="small subtle">
        {{ item.source === 'cf' ? 'Codeforces' : 'AtCoder' }}：{{
          item.fullHistory ? '已完成全量同步' : '历史完整性待确认'
        }}
        · 最近成功同步 {{ item.latestSync ? date(item.latestSync) : '无' }}
      </p>
    </template>
  </section>
</template>
<style scoped>
.monthly-report {
  min-width: 0;
}
.monthly-report h3 {
  margin-top: 1.8rem;
}
.monthly-report p,
.monthly-report li {
  overflow-wrap: anywhere;
}
.monthly-report .section-head,
.monthly-report .button-row {
  flex-wrap: wrap;
}
.monthly-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
}
.monthly-metrics article {
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
}
.monthly-metrics span {
  display: block;
  font-size: 0.85rem;
}
.monthly-metrics strong {
  display: block;
  font-size: 2rem;
}
.monthly-comparison {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.monthly-days {
  display: grid;
  gap: 0.35rem;
}
.monthly-days > div {
  display: grid;
  grid-template-columns: 3rem minmax(20px, 1fr) minmax(180px, 1fr);
  align-items: center;
  gap: 0.6rem;
}
.monthly-bar {
  height: 7px;
  background: #8882;
  border-radius: 8px;
  overflow: hidden;
}
.monthly-bar span {
  display: block;
  height: 100%;
  background: var(--accent, #bd553b);
}
.monthly-contest,
.monthly-finding,
.monthly-evidence {
  border-bottom: 1px solid var(--line);
  padding: 0.9rem 0;
}
.monthly-contest > span {
  display: block;
  font-size: 0.8rem;
  margin-top: 0.4rem;
}
.monthly-finding details {
  font-size: 0.85rem;
}
@media (max-width: 600px) {
  .monthly-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .monthly-days > div {
    grid-template-columns: 2.5rem minmax(20px, 1fr);
  }
  .monthly-days > div > span:last-child {
    grid-column: 2;
  }
}
</style>
