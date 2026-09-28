<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { RefreshCw, ArrowUpRight } from 'lucide-vue-next';
import { api } from '../api';
import { verdictLabel } from '../../shared/domain';
import type { AnalysisReport } from '../../shared/contest-analysis';
const props = defineProps<{ contestId: number }>();
const emit = defineEmits<{ updated: [] }>();
const report = ref<AnalysisReport | null>(null),
  sessionKey = ref(''),
  error = ref(''),
  loading = ref(false);
const current = computed(
  () => report.value?.sessions.find((s) => s.session.key === sessionKey.value) ?? report.value?.sessions[0],
);
const labels: Record<string, string> = {
  CONTESTANT: '正式参赛',
  OUT_OF_COMPETITION: '非正式参赛',
  VIRTUAL: '虚拟参赛',
};
let alive = true,
  timer: ReturnType<typeof setTimeout> | undefined;
const time = (seconds: number | null) =>
  seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
async function read(auto = false) {
  try {
    const data = await api<AnalysisReport>(`/contests/${props.contestId}/analysis`);
    if (!alive) return;
    const wasRunning = report.value?.task.status === 'running';
    report.value = data;
    if (data.task.status === 'running') timer = setTimeout(() => void read(), 1200);
    else if (wasRunning) emit('updated');
    if (auto && !data.fetchedAt && data.task.status === 'idle' && data.sessions.length && navigator.onLine)
      await refresh();
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  }
}
async function refresh() {
  loading.value = true;
  error.value = '';
  clearTimeout(timer);
  try {
    const data = await api<AnalysisReport>(`/contests/${props.contestId}/analysis/refresh`, {});
    if (!alive) return;
    report.value = data;
    timer = setTimeout(() => void read(), 1000);
  } catch (e) {
    if (alive) {
      error.value = (e as Error).message;
      if (error.value.includes('另一场比赛正在分析')) timer = setTimeout(() => void read(true), 1500);
    }
  } finally {
    if (alive) loading.value = false;
  }
}
onMounted(() => void read(true));
onBeforeUnmount(() => {
  alive = false;
  clearTimeout(timer);
});
</script>
<template>
  <section class="auto-report" aria-label="自动比赛报告">
    <div class="report-toolbar">
      <h3>自动表现分析</h3>
      <button class="secondary" :disabled="loading || report?.task.status === 'running'" @click="refresh">
        <RefreshCw :size="15" />{{ report?.task.status === 'running' ? '分析中…' : '刷新分析' }}
      </button>
    </div>
    <p class="small subtle">
      根据最新同步判定分析；无法还原历史评测过程。预估 CF 表现分是本站估算，不代表官方 Rating 变化，也不能与
      XCPC 来源分直接换算。
    </p>
    <p v-if="report?.fetchedAt" class="small subtle">
      数据更新：{{ new Date(report.fetchedAt).toLocaleString('zh-CN') }} · 算法 v{{
        current?.version ?? '1.0'
      }}
    </p>
    <p
      v-if="report?.task.message"
      :class="['alert', { error: report.task.status === 'failed' }]"
      role="status"
    >
      {{ report.task.message }}
    </p>
    <p v-if="error" class="alert error">{{ error }}</p>
    <p v-for="warning in report?.warnings" :key="warning" class="small subtle">{{ warning }}</p>
    <label v-if="report && report.sessions.length > 1"
      >参赛场次<select v-model="sessionKey">
        <option v-for="s in report.sessions" :key="s.session.key" :value="s.session.key">
          {{ labels[s.session.type] }} ·
          {{ s.session.start ? new Date(s.session.start * 1000).toLocaleString('zh-CN') : '开始时间缺失' }}
        </option>
      </select></label
    >
    <template v-if="current">
      <div :key="current.session.key" class="report-score">
        <div>
          <span class="eyebrow">{{ labels[current.session.type] }} / CF PERFORMANCE</span>
          <div class="score-value">
            {{
              current.performanceRating.bound === 'upper'
                ? '≥'
                : current.performanceRating.bound === 'lower'
                  ? '≤'
                  : ''
            }}{{ current.performanceRating.value ?? '—'
            }}<small v-if="current.performanceRating.value !== null"> CF Rating</small>
          </div>
          <strong>本站预估表现分</strong>
          <p class="performance-method">
            {{
              current.performanceRating.method === 'rank'
                ? '正式赛 · 名次反推'
                : current.performanceRating.method === 'difficulty'
                  ? '低置信度 · 难度估算'
                  : current.performanceRating.reason
            }}
          </p>
          <div class="score-secondary">
            综合复盘分 <b>{{ current.score === null ? '—' : `${current.score} / 100` }}</b
            ><span v-if="current.score !== null && current.provisional"> · 暂估</span>
          </div>
        </div>
        <div class="score-facts">
          <span
            >赛时 AC <b>{{ current.solved }}</b> / 尝试 {{ current.attempted }} 题</span
          ><span
            >赛时提交 <b>{{ current.submissions }}</b> 次</span
          ><span
            >首次 AC <b>{{ time(current.firstAC) }}</b></span
          ><span
            >有效评分权重 <b>{{ current.eligibleWeight }}%</b></span
          >
        </div>
      </div>
      <details class="report-context performance-details">
        <summary>预估表现分的依据 · 算法 v{{ current.performanceRating.version }}</summary>
        <p>{{ current.performanceRating.reason }}</p>
        <p v-if="current.performanceRating.method === 'rank'">
          同场赛前 Rating 算出预期名次 seed；目标名次 = √(seed × 实际名次)，再反求对应 Rating。样本：{{
            current.performanceRating.samples
          }}
          名对照选手。
        </p>
        <p v-else-if="current.performanceRating.method === 'difficulty'">
          按题目难度估计各题 AC 概率，反求与赛时 AC 数匹配的 Rating；全 AC、零 AC 使用平滑目标。样本：{{
            current.performanceRating.samples
          }}
          题。此法与 XCPC 的名次反推不同。
        </p>
        <p v-if="current.performanceRating.bound">结果超出 0–4000 的显示范围，仅显示边界。</p>
      </details>
      <p v-for="warning in current.warnings" :key="warning" class="small subtle">{{ warning }}</p>
      <div :key="current.session.key" class="score-parts">
        <article v-for="part in current.parts" :key="part.id" class="score-part">
          <div class="report-toolbar">
            <strong>{{ part.label }}</strong
            ><span>{{ part.weight }}%</span>
          </div>
          <b class="part-number">{{ part.score === null ? '—' : part.score.toFixed(1) }}</b>
          <div class="score-track">
            <span :style="{ transform: `scaleX(${(part.score ?? 0) / 100})` }"></span>
          </div>
          <p>{{ part.reason }}</p>
          <details>
            <summary>公式与样本</summary>
            <p>{{ part.formula }}</p>
            <p>有效样本：{{ part.samples }}；分数限制在 0–100。缺失项不按零分计算。</p>
          </details>
        </article>
      </div>
      <div v-if="current.official" class="report-context">
        <strong>官方成绩与对照</strong>
        <p>
          个人榜单 #{{ current.official.rank }} · {{ current.official.participants }} 人 · 官方得分
          {{ current.official.points }} · 超越 {{ (current.official.percentile * 100).toFixed(1) }}%
        </p>
        <p>
          赛前 Rating：{{ current.preRating ?? '缺失' }}。榜单与评级对照来自同次抓取；IOI
          部分得分保留展示，难度项仅计完整 AC。
        </p>
      </div>
      <details class="report-deep-dive">
        <summary>分题提交时间线 · {{ current.timeline.length }} 题</summary>
        <p class="small subtle">时间为开赛后分钟:秒；提交间隔不等于思考时长。未提交题仅供补题参考。</p>
        <article
          v-for="(p, index) in current.timeline"
          :key="`${current.session.key}:${p.index}`"
          class="timeline-problem"
          :style="{ '--motion-index': Math.min(index, 5) }"
        >
          <div class="report-toolbar">
            <a
              :href="`https://codeforces.com/contest/${contestId}/problem/${p.index}`"
              target="_blank"
              rel="noopener noreferrer"
              ><strong>{{ p.index }} · {{ p.name }}</strong> <ArrowUpRight :size="13" /></a
            ><span class="small subtle">{{ p.rating ?? '难度未知' }}</span>
          </div>
          <p class="small subtle">
            {{
              p.events.length
                ? `首次提交 ${time(p.first)} · 首次 AC ${time(p.ac)} · 计分失败 ${p.failures} 次`
                : '未尝试'
            }}
          </p>
          <ol class="submission-timeline">
            <li v-for="event in p.events" :key="event.id">
              <a
                :href="event.url"
                target="_blank"
                rel="noopener noreferrer"
                :class="{
                  accepted: event.verdict === 'OK',
                  failed: [
                    'WRONG_ANSWER',
                    'TIME_LIMIT_EXCEEDED',
                    'RUNTIME_ERROR',
                    'COMPILATION_ERROR',
                    'MEMORY_LIMIT_EXCEEDED',
                  ].includes(event.verdict),
                }"
                >{{ time(event.seconds) }} · {{ verdictLabel[event.verdict] ?? event.verdict }}
                <small>#{{ event.id }}</small></a
              >
            </li>
          </ol>
        </article>
      </details>
      <h3>下一场的行动建议</h3>
      <p v-if="!current.advice.length" class="subtle">目前没有足够证据触发具体建议。</p>
      <article v-for="(advice, i) in current.advice" :key="advice.id" class="advice-card">
        <span class="eyebrow">{{ String(i + 1).padStart(2, '0') }} / ACTION</span>
        <p>
          <strong>{{ advice.evidence }}</strong>
        </p>
        <p class="subtle">{{ advice.possibility }}</p>
        <p>{{ advice.action }}</p>
        <div class="evidence-links">
          <a
            v-for="id in advice.submissionIds"
            :key="id"
            :href="`https://codeforces.com/contest/${contestId}/submission/${id}`"
            target="_blank"
            rel="noopener noreferrer"
            >#{{ id }}</a
          ><a
            v-if="advice.problemIndex"
            :href="`https://codeforces.com/contest/${contestId}/problem/${advice.problemIndex}`"
            target="_blank"
            rel="noopener noreferrer"
            >查看题目 {{ advice.problemIndex }}</a
          >
        </div>
      </article>
    </template>
    <p v-else-if="report" class="alert">仅练习或没有可识别的参赛记录，不生成比赛表现分。</p>
    <p v-else class="subtle">正在读取比赛数据…</p>
    <details v-if="report?.practiceCount" class="manual-contest-notes">
      <summary>练习 / 赛后补题 · {{ report.practiceCount }} 条提交（不计分）</summary>
      <ol class="submission-timeline">
        <li v-for="s in report.practiceSubmissions" :key="s.id">
          <a
            :href="`https://codeforces.com/contest/${contestId}/submission/${s.id}`"
            target="_blank"
            rel="noopener noreferrer"
            >{{ s.index }} · {{ new Date(s.time * 1000).toLocaleString('zh-CN') }} ·
            {{ verdictLabel[s.verdict] ?? s.verdict }} #{{ s.id }}</a
          >
        </li>
      </ol>
    </details>
  </section>
</template>
