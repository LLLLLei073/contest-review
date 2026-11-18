<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CalendarDays, ExternalLink, RefreshCw, Sparkles, Repeat, Gauge, Swords } from 'lucide-vue-next';
import { api, notify } from '../../api';
import { categoryNames, type CategoryName } from '../../../shared/training';
import { phaseLabels, roleLabels } from '../../../shared/program-domain';
import type { ProgramProgress, TrainingProgram } from '../../../shared/program-domain';
import type { ProgramReport, ProgramReportFinding } from '../../../shared/program-report';
import RadarChart from '../charts/RadarChart.vue';

interface ProgramCatalogEntry {
  name: string;
  rating: number | null;
  url: string;
}
interface ProgramState {
  draft: TrainingProgram | null;
  active: TrainingProgram | null;
  progress: ProgramProgress | null;
  today: {
    keys: string[];
    reasons: Record<string, string>;
    shortage: string | null;
    dayIndex: number | null;
    carryCount: number;
    date: string;
    theme: string | null;
    phase: string | null;
  };
  analysis: {
    mastery: { name: CategoryName; score: number; samples: number }[];
    suggestedFocus: CategoryName[];
    band: { minimum: number; maximum: number; preferred: number; basis: string };
  };
  summary: { total: number; ac: number; independent: number } | null;
  report: ProgramReport | null;
  /** 仅 generate 响应携带：生成时的候选不足等提示。 */
  generationWarnings?: string[];
  catalog: Record<string, ProgramCatalogEntry>;
}
const state = ref<ProgramState | null>(null);
const emit = defineEmits<{ refresh: [] }>();
const error = ref('');
const busy = ref(false);
const loading = ref(true);
const duration = ref<7 | 14>(14);
const style = ref<'balanced' | 'sprint' | 'steady'>('balanced');
const dailyCount = ref(8);
const focus = ref<CategoryName[]>([]);
const includeAtcoder = ref(false);
const swapping = ref('');
const aiReport = ref<{ findings: ProgramReportFinding[]; warnings: string[] } | null>(null);
const aiBusy = ref(false);
const statusLabels: Record<string, string> = {
  done: '已完成',
  partial: '部分完成',
  todo: '未开始',
  missed: '已过期 · 可补做',
};
const statusClasses: Record<string, string> = {
  done: 'mastered',
  partial: 'pending',
  todo: 'reviewing',
  missed: 'pending',
};
const weakest = computed(() =>
  [...(state.value?.analysis.mastery ?? [])].sort((a, b) => a.score - b.score).slice(0, 3),
);
const program = computed(() => state.value?.draft ?? state.value?.active ?? null);
const isDraft = computed(() => !!state.value?.draft);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    state.value = await api<ProgramState>('/program/state');
    aiReport.value = null;
    if (!focus.value.length) focus.value = [...state.value.analysis.suggestedFocus];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function toggleFocus(name: CategoryName) {
  const list = focus.value;
  const index = list.indexOf(name);
  if (index >= 0) focus.value = list.filter((f) => f !== name);
  else if (list.length < 2) focus.value = [...list, name];
  else focus.value = [list[1], name];
}
async function generate() {
  if (!focus.value.length) {
    notify('请至少选择一个主攻领域');
    return;
  }
  busy.value = true;
  try {
    state.value = await api<ProgramState>('/program/generate', {
      duration: duration.value,
      style: style.value,
      dailyCount: dailyCount.value,
      focus: focus.value,
      includeAtcoder: includeAtcoder.value,
    });
    notify(`已生成 ${duration.value} 天训练预览，确认后今天即可开始`);
  } catch (e) {
    notify((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function confirmProgram(id: string) {
  busy.value = true;
  try {
    state.value = await api<ProgramState>('/program/confirm', { id });
    notify('长期计划已生效，今日题单已按第 1 天安排');
    emit('refresh');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function abandonProgram(id: string) {
  if (!window.confirm('确定放弃当前长期计划？已完成的题目会保留在记录中。')) return;
  busy.value = true;
  try {
    state.value = await api<ProgramState>('/program/abandon', { id });
    notify('已放弃该计划，可随时重新生成');
    emit('refresh');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function swap(id: string, date: string, key: string) {
  swapping.value = key;
  try {
    state.value = await api<ProgramState>('/program/swap', { id, date, key });
    notify('已更换为同难度带的新题');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    swapping.value = '';
  }
}
const pastStats = computed(() => {
  const progress = state.value?.progress;
  if (!progress || !state.value)
    return { days: 0, ac: 0, total: 0, rate: 0 };
  const past = progress.days.filter((d) => d.date < state.value!.today.date);
  const ac = past.reduce((sum, d) => sum + d.ac, 0);
  const total = past.reduce((sum, d) => sum + d.total, 0);
  return { days: past.length, ac, total, rate: total ? ac / total : 0 };
});
const calibrationHint = computed(() => {
  const { days, rate } = pastStats.value;
  if (days < 2) return null;
  const share = Math.round(rate * 100);
  if (rate >= 0.85) return `前半程完成率 ${share}%：执行力强，可校准上调剩余难度`;
  if (rate < 0.5) return `前半程完成率 ${share}%：建议校准下调难度与负荷`;
  return `前半程完成率 ${share}%：可校准刷新剩余选题`;
});
async function recalibrate(id: string) {
  if (!window.confirm('按前半程完成率校准剩余计划？剩余天的题目会按校准结果重新选择。')) return;
  busy.value = true;
  try {
    state.value = await api<ProgramState>('/program/recalibrate', { id });
    notify('已按前半程表现校准剩余计划');
    emit('refresh');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    busy.value = false;
  }
}
const showReport = computed(
  () =>
    !!state.value?.report &&
    (state.value.active?.status === 'completed' || state.value.report!.metrics.elapsedDays >= 3),
);
const radarSeries = computed(() => {
  const program = state.value?.active;
  if (!program || !state.value) return [];
  const current = new Map(state.value.analysis.mastery.map((m) => [m.name, m.score]));
  const series: { name: string; values: number[] }[] = [];
  if (program.baselineMastery?.length) {
    const before = new Map(program.baselineMastery.map((m) => [m.name, m.score]));
    series.push({ name: '计划前', values: categoryNames.map((n) => before.get(n) ?? 0) });
    series.push({ name: '当前', values: categoryNames.map((n) => current.get(n) ?? 0) });
  } else {
    series.push({ name: '当前掌握度', values: categoryNames.map((n) => current.get(n) ?? 0) });
  }
  return series;
});
function evidenceById(report: ProgramReport, id: string) {
  return report.evidence.find((e) => e.id === id);
}
async function loadAiReport() {
  const program = state.value?.active;
  const report = state.value?.report;
  if (!program || !report) return;
  aiBusy.value = true;
  try {
    const result = await api<{
      findings: ProgramReportFinding[];
      warnings: string[];
      fingerprint: string;
    }>('/learning/program-report', { programId: program.id, fingerprint: report.fingerprint });
    aiReport.value = { findings: result.findings, warnings: result.warnings };
    notify(result.findings.length ? 'AI 解读已生成' : 'AI 未给出额外解读');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    aiBusy.value = false;
  }
}
/** 一键续期：把报告结论（难度平移/题量/领域策略）直接作为下一期计划的输入。 */
async function generateNextRound() {
  const finished = state.value?.active;
  const report = state.value?.report;
  if (!finished || !report) return;
  busy.value = true;
  try {
    state.value = await api<ProgramState>('/program/generate', {
      duration: finished.duration,
      style: finished.style ?? 'balanced',
      dailyCount: Math.max(6, Math.min(10, finished.dailyCount + report.nextRound.dailyCountDelta)),
      carryOver: {
        fromProgramId: finished.id,
        difficultyShift: report.nextRound.difficultyShift,
        dailyCountDelta: report.nextRound.dailyCountDelta,
        ...(report.nextRound.focus === 'rotate' ? { rotateFocus: true } : {}),
      },
      includeAtcoder: includeAtcoder.value,
    });
    notify('已按上一期结论生成下一期预览，确认后生效');
    emit('refresh');
  } catch (e) {
    notify((e as Error).message);
  } finally {
    busy.value = false;
  }
}
function weekday(date: string) {
  return new Date(date + 'T12:00:00+08:00').toLocaleDateString('zh-CN', { weekday: 'short' });
}
function isDone(progressDay: ProgramProgress['days'][number] | undefined, key: string) {
  return progressDay ? !progressDay.carry.includes(key) : false;
}
function problemInfo(key: string) {
  return state.value?.catalog[key] ?? null;
}
onMounted(load);
</script>
<template>
  <div class="panel program-panel" :aria-busy="loading">
    <div class="section-head">
      <div>
        <span class="eyebrow">LONG-RUN PROGRAM</span>
        <h2>长期训练计划</h2>
        <p>
          依据失败提交、错题与掌握度，一次性生成未来
          {{ duration }} 天的全部题单：难度逐日爬坡，每天内部再按热身 → 核心 → 拉伸递进。
        </p>
      </div>
    </div>
    <div v-if="error" class="alert error" role="alert">{{ error }}<button @click="load">重试</button></div>

    <template v-if="state && !state.draft && !state.active">
      <div class="program-wizard">
        <div class="program-field">
          <span class="program-label">计划时长</span>
          <div class="button-row">
            <button :class="['button', duration === 7 && 'primary']" @click="duration = 7">7 天冲刺</button>
            <button :class="['button', duration === 14 && 'primary']" @click="duration = 14">14 天进阶</button>
          </div>
        </div>
        <div class="program-field">
          <span class="program-label">训练风格</span>
          <div class="button-row">
            <button
              :class="['button', style === 'balanced' && 'primary']"
              title="含复盘节点与挑战日的完整弧线"
              @click="style = 'balanced'"
            >
              均衡进阶
            </button>
            <button
              :class="['button', style === 'sprint' && 'primary']"
              title="无复盘节点，难度爬坡更快，挑战日上探 +400"
              @click="style = 'sprint'"
            >
              纯冲刺
            </button>
            <button
              :class="['button', style === 'steady' && 'primary']"
              title="节奏优先：多个复盘节点、无挑战日，最高段 +150"
              @click="style = 'steady'"
            >
              稳态节奏
            </button>
          </div>
        </div>
        <div class="program-field">
          <span class="program-label">每日新题量：{{ dailyCount }} 题（特殊日自动减量）</span>
          <input v-model.number="dailyCount" type="range" min="6" max="10" step="1" />
        </div>
        <div class="program-field">
          <span class="program-label">主攻领域（最多 2 个，已预选最薄弱项）</span>
          <div class="program-focus-row">
            <button
              v-for="name in categoryNames"
              :key="name"
              :class="['badge', focus.includes(name) ? 'mastered' : 'reviewing']"
              @click="toggleFocus(name)"
            >
              {{ name }}
            </button>
          </div>
        </div>
        <div class="program-field">
          <label class="program-label program-check">
            <input v-model="includeAtcoder" type="checkbox" />
            热身档纳入 AtCoder 题（按估计难度选取，知识点未映射，每天至多 1 道）
          </label>
        </div>
        <div v-if="weakest.length" class="program-analysis">
          <span class="eyebrow">WEAK POINTS</span>
          <p>
            当前掌握度最低：<template v-for="(area, i) in weakest" :key="area.name"
              >{{ i ? '、' : '' }}{{ area.name }} {{ area.score }}/100</template
            >；难度基准 {{ state.analysis.band.minimum }}–{{ state.analysis.band.maximum }}（{{ state.analysis.band.basis }}）。
          </p>
        </div>
        <button class="button primary" :disabled="busy || loading" @click="generate">
          <Sparkles :size="15" /> 分析并生成全部 {{ duration }} 天预览
        </button>
        <p class="small subtle">
          新题仅从 Codeforces 公开题库选取（含全网通过数质量评估）；AtCoder/洛谷仅参与复习与统计。
        </p>
      </div>
    </template>

    <template v-if="state && program">
      <div v-if="state.generationWarnings?.length" class="alert program-generation-warnings">
        <p v-for="warning in state.generationWarnings" :key="warning">{{ warning }}</p>
      </div>
      <div class="program-overview">
        <div class="program-overview-main">
          <span class="eyebrow">{{
            isDraft ? 'PREVIEW · 待确认' : program.status === 'completed' ? 'COMPLETED · 已完成' : 'ACTIVE · 进行中'
          }}</span>
          <h3>
            {{ program.duration }} 天 · {{ program.focus.join('、') }} · 每天 {{ program.dailyCount }} 题 ·{{
              program.style === 'sprint' ? '纯冲刺' : program.style === 'steady' ? '稳态节奏' : '均衡进阶'
            }}
          </h3>
          <p class="small subtle">{{ program.basis }}</p>
        </div>
        <div class="program-overview-side">
          <div
            v-if="state.progress"
            class="daily-progress"
            role="progressbar"
            aria-label="长期计划总进度"
            :aria-valuenow="state.progress.percent"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span :style="{ transform: `scaleX(${state.progress.percent / 100})` }"></span>
          </div>
          <p v-if="state.progress" class="small">
            第 {{ (state.progress.currentIndex ?? 0) + 1 }}/{{ program.duration }} 天 · 总进度
            {{ state.progress.percent }}% · 完成 {{ state.progress.doneDays }} 天
          </p>
          <p v-else-if="isDraft" class="small">共 {{ program.days.length }} 天，确认后立即生效</p>
          <p v-if="state.summary" class="small subtle">
            已完成 {{ state.summary.ac }}/{{ state.summary.total }} 题 · 独立做出 {{ state.summary.independent }} 题
          </p>
          <p v-if="!isDraft && calibrationHint" class="small program-hint">
            <Gauge :size="13" /> {{ calibrationHint }}
          </p>
          <div class="button-row">
            <button v-if="isDraft" class="button primary" :disabled="busy" @click="confirmProgram(program.id)">
              采纳生效
            </button>
            <button v-if="isDraft" class="button" :disabled="busy" @click="generate">
              <RefreshCw :size="14" /> 重新生成
            </button>
            <button
              v-if="!isDraft && program.status === 'active' && pastStats.days >= 2"
              class="small-button"
              :disabled="busy"
              @click="recalibrate(program.id)"
            >
              <Gauge :size="12" /> 校准剩余计划
            </button>
            <RouterLink
              v-if="!isDraft && program.status === 'active'"
              class="small-button"
              :to="'/battle?theme=' + encodeURIComponent(program.focus.join('+'))"
            >
              <Swords :size="12" /> 按焦点开连战
            </RouterLink>
            <button
              v-if="!isDraft && program.status === 'active'"
              class="small-button"
              :disabled="busy"
              @click="abandonProgram(program.id)"
            >
              放弃计划
            </button>
            <button v-else class="small-button" :disabled="busy" @click="abandonProgram(program.id)">
              放弃预览
            </button>
          </div>
        </div>
      </div>
      <div v-if="state.today.theme" class="program-today">
        <CalendarDays :size="16" />
        <span>
          今天（第 {{ (state.today.dayIndex ?? 0) + 1 }} 天）· {{ state.today.theme }}
          <template v-if="state.today.carryCount"> · 含 {{ state.today.carryCount }} 道补做题</template>
          ，已同步到「今日题单」。
        </span>
      </div>

      <section v-if="state.report && showReport" class="panel program-report">
        <div class="section-head">
          <div>
            <span class="eyebrow">PROGRAM REPORT</span>
            <h2>{{ state.report.metrics.finished ? '计划总结报告' : '阶段报告（进行中）' }}</h2>
            <p class="small subtle">
              完成 {{ state.report.metrics.ac }}/{{ state.report.metrics.planned }} 题（{{
                Math.round(state.report.metrics.completionRate * 100)
              }}%）· 独立完成率
              {{ state.report.metrics.independentRate == null ? '—' : Math.round(state.report.metrics.independentRate * 100) + '%' }}
              · 完成 {{ state.report.metrics.doneDays }} 天 / 落下 {{ state.report.metrics.missedDays }} 天 · 补做占
              {{ Math.round(state.report.metrics.carryShare * 100) }}%
              <template v-if="state.report.metrics.simulations.endedCount"
                >· 模拟赛 {{ state.report.metrics.simulations.endedCount }} 场（平均完成
                {{ Math.round((state.report.metrics.simulations.solvedAvg ?? 0) * 100) }}%）</template
              >
            </p>
          </div>
        </div>
        <div v-if="state.report.metrics.finished" class="alert program-next-round">
          <div>
            <strong>下一期建议：</strong>{{ state.report.nextRound.reason }}
          </div>
          <button class="button primary" :disabled="busy" @click="generateNextRound">
            按此结论生成下一期预览
          </button>
        </div>
        <div v-if="radarSeries.length" class="program-radar">
          <RadarChart
            :key="`program-radar-${radarSeries.length}`"
            :axes="[...categoryNames]"
            :series="radarSeries"
            labels
            aria-label="计划前后八领域掌握度对比"
          />
        </div>
        <div v-if="state.report.warnings.length">
          <p v-for="warning in state.report.warnings" :key="warning" class="small subtle">
            {{ warning }}
          </p>
        </div>
        <ol class="program-findings">
          <li v-for="finding in state.report.findings" :key="finding.title">
            <article>
              <strong>{{ finding.title }}</strong>
              <p>{{ finding.cause }}</p>
              <p class="small">下一步：{{ finding.action }}</p>
              <details v-if="finding.evidenceIds.length">
                <summary class="small subtle">查看依据</summary>
                <ul>
                  <li v-for="id in finding.evidenceIds" :key="id" class="small subtle">
                    {{ evidenceById(state.report!, id)?.text }}
                    <a
                      v-if="evidenceById(state.report!, id)?.url && !evidenceById(state.report!, id)!.url.startsWith('/')"
                      :href="evidenceById(state.report!, id)!.url"
                      target="_blank"
                      rel="noreferrer"
                      >打开 <ExternalLink :size="11"
                    /></a>
                    <RouterLink v-else-if="evidenceById(state.report!, id)?.url" :to="evidenceById(state.report!, id)!.url"
                      >打开</RouterLink
                    >
                  </li>
                </ul>
              </details>
            </article>
          </li>
        </ol>
        <div class="button-row">
          <button class="small-button" :disabled="aiBusy" @click="loadAiReport">
            {{ aiBusy ? '解读中…' : aiReport ? '刷新 AI 解读' : 'AI 解读' }}
          </button>
          <span class="small subtle">规则报告本地生成；AI 解读需已配置模型。</span>
        </div>
        <ol v-if="aiReport?.findings.length" class="program-findings">
          <li v-for="finding in aiReport.findings" :key="finding.title">
            <article>
              <strong>{{ finding.title }}</strong>
              <p>{{ finding.cause }}</p>
              <p class="small">下一步：{{ finding.action }}</p>
            </article>
          </li>
        </ol>
      </section>

      <div class="program-timeline">
        <article
          v-for="(day, index) in program.days"
          :key="day.date"
          class="program-day"
          :class="{ 'program-day-current': day.date === state.today.date }"
        >
          <header class="program-day-head">
            <div class="program-day-title">
              <span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <strong>
                  {{ day.date.slice(5) }}（{{ weekday(day.date) }}）
                  <span v-if="day.date === state.today.date" class="badge mastered">今天</span>
                </strong>
                <div class="daily-meta">
                  <span :class="['program-phase', `phase-${day.phase}`]">{{ phaseLabels[day.phase] }}</span>
                  {{ day.theme }} · 难度 {{ day.band.minimum }}–{{ day.band.maximum }}（目标
                  {{ day.band.preferred }}）· 约 {{ day.estimateMinutes }} 分钟
                </div>
              </div>
            </div>
            <span
              v-if="state.progress"
              :class="['badge', statusClasses[state.progress.days[index]?.status ?? 'todo']]"
            >
              {{ statusLabels[state.progress.days[index]?.status ?? 'todo']
              }}<template v-if="state.progress.days[index]?.ac"
                >{{ state.progress.days[index]?.ac }}/{{ state.progress.days[index]?.total }}</template
              >
            </span>
            <span v-else :class="['badge', 'reviewing']">{{ day.problems.length }} 题</span>
          </header>
          <p v-if="day.shortage" class="small subtle program-shortage">{{ day.shortage }}</p>
          <ul class="program-problems">
            <li v-for="pick in day.problems" :key="pick.key">
              <span :class="['program-role', `role-${pick.role}`]">{{ roleLabels[pick.role] }}</span>
              <a :href="problemInfo(pick.key)?.url ?? '#'" target="_blank" rel="noreferrer">
                {{ problemInfo(pick.key)?.name ?? pick.key }}
                <ExternalLink :size="12" />
              </a>
              <span class="small subtle">{{ problemInfo(pick.key)?.rating ?? '?' }}</span>
              <span class="program-reason small subtle">{{ day.reasons[pick.key] }}</span>
              <button
                v-if="!isDone(state.progress?.days[index], pick.key)"
                class="small-button"
                :disabled="swapping === pick.key || busy"
                @click="swap(program.id, day.date, pick.key)"
              >
                <Repeat :size="12" /> {{ swapping === pick.key ? '换题中…' : '换题' }}
              </button>
              <span v-else :class="['badge', 'mastered']">已 AC</span>
            </li>
          </ul>
        </article>
      </div>
    </template>

    <div v-if="loading && !state" class="quiet-empty" role="status">正在读取训练计划…</div>
  </div>
</template>
