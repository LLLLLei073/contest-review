<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, computed, watch } from 'vue';
import { api } from '../api';
import type { Statistics } from '../../shared/domain';
import type { WeeklyGoal } from '../../shared/weekly';
import { useSpringValues } from '../motion';
import { useSection } from '../sections';
import { useLearningState } from '../learningState';
const LearningActivity = defineAsyncComponent(() => import('../components/LearningActivity.vue'));
const PlanningWorkspace = defineAsyncComponent(() => import('../components/training/PlanningWorkspace.vue'));
import MonthlyReport from '../components/MonthlyReport.vue';
const stats = ref<Statistics | null>(null),
  error = ref(''),
  loading = ref(true);
const source = useSection(['all', 'cf', 'atcoder'] as const, 'all', 'source');
const activeSection = useSection(
  ['overview', 'monthly', 'activity', 'diagnosis', 'knowledge'] as const,
  'overview',
);
const activityPart = useSection(['records', 'distribution', 'reasons'] as const, 'records', 'chart');
const masteryView = ref<'chart' | 'list'>('chart');
const learning = useLearningState();
const activityOpened = ref(activeSection.value === 'diagnosis');
watch(activeSection, () => {
  if (activeSection.value === 'diagnosis') activityOpened.value = true;
});
function showSection(id: string) {
  activeSection.value = id as typeof activeSection.value;
}
const weekly = ref<{
  goal: WeeklyGoal | null;
  assigned: number;
  completed: number;
  coverage: Record<string, number>;
} | null>(null);
const reasonTrend = ref<{ week: string; samples: number; reasons: { name: string; count: number }[] }[]>([]);
const radarSpring = useSpringValues(Array(8).fill(0));
let alive = true;
const maximum = computed(() =>
  Math.max(1, ...(stats.value?.trend.map((t) => t.independent + t.hint + t.failed) || [])),
);
const radarPoint = (index: number, radius: number) => {
  const angle = -Math.PI / 2 + (index * Math.PI) / 4;
  return `${160 + Math.cos(angle) * radius},${160 + Math.sin(angle) * radius}`;
};
const radarRing = (radius: number) => Array.from({ length: 8 }, (_, i) => radarPoint(i, radius)).join(' ');
const radarShape = computed(
  () => stats.value?.mastery.map((_, i) => radarPoint(i, radarSpring.values.value[i] * 1.1)).join(' ') ?? '',
);
let loadSerial = 0;
async function load() {
  const serial = ++loadSerial;
  if (activeSection.value === 'diagnosis') {
    void learning.load();
    return;
  }
  if (activeSection.value === 'monthly') return;
  loading.value = true;
  error.value = '';
  try {
    const currentSource = source.value;
    const next = await api<Statistics>('/statistics?source=' + currentSource);
    if (!alive || serial !== loadSerial) return;
    stats.value = next;
    radarSpring.setTarget(next.mastery.map((area) => area.score));
    if (activeSection.value === 'overview') {
      const nextWeekly = await api<NonNullable<typeof weekly.value>>('/training/weekly');
      if (alive && serial === loadSerial) weekly.value = nextWeekly;
    } else {
      const nextTrend = await api<typeof reasonTrend.value>('/training/reason-trend?source=' + currentSource);
      if (alive && serial === loadSerial) reasonTrend.value = nextTrend;
    }
  } catch (e) {
    if (alive && serial === loadSerial) error.value = (e as Error).message;
  } finally {
    if (alive && serial === loadSerial) loading.value = false;
  }
}
watch([activeSection, source], load, { immediate: true });
onBeforeUnmount(() => {
  alive = false;
});
</script>
<template>
  <div class="page-head statistics-head">
    <div>
      <div class="eyebrow">PROGRESS, NOT PERFECTION</div>
      <h1>训练统计</h1>
      <details class="statistics-ai-actions">
        <summary>AI 分析</summary>
        <div class="button-row">
          <RouterLink to="/companion">请星澪分析学习进展</RouterLink>
          <RouterLink to="/statistics?view=diagnosis">生成 AI 学情诊断</RouterLink>
        </div>
      </details>
      <p>找到反复出现的问题，让下一次练习更有方向。</p>
    </div>
    <div class="contest-filter statistics-source">
      <label
        >统计来源
        <select v-model="source">
          <option value="all">两站合计</option>
          <option value="cf">Codeforces</option>
          <option value="atcoder">AtCoder</option>
        </select></label
      >
    </div>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <nav class="content-switcher" aria-label="训练统计内容">
    <button
      v-for="item in [
        { id: 'overview', label: '训练概览' },
        { id: 'monthly', label: '月度报告' },
        { id: 'activity', label: '练习趋势' },
        { id: 'diagnosis', label: '学情诊断' },
        { id: 'knowledge', label: '知识状态' },
      ]"
      :key="item.id"
      :class="{ active: activeSection === item.id }"
      :aria-current="activeSection === item.id ? 'page' : undefined"
      @click="showSection(item.id)"
    >
      {{ item.label }}
    </button>
  </nav>
  <nav v-if="activeSection === 'activity'" class="content-switcher sub-switcher" aria-label="练习趋势分区">
    <button
      v-for="item in [
        { id: 'records', label: '重做与题单' },
        { id: 'distribution', label: '错因与算法分布' },
        { id: 'reasons', label: '错因变化' },
      ] as const"
      :key="item.id"
      :class="{ active: activityPart === item.id }"
      :aria-pressed="activityPart === item.id"
      @click="activityPart = item.id"
    >
      {{ item.label }}
    </button>
  </nav>
  <LearningActivity
    v-if="activityOpened"
    v-show="activeSection === 'diagnosis'"
    mode="diagnosis"
    :session="learning"
  />
  <MonthlyReport v-if="activeSection === 'monthly'" :source="source" />
  <PlanningWorkspace v-if="activeSection === 'knowledge'" mode="knowledge" />
  <div v-show="activeSection === 'overview' || activeSection === 'activity'">
    <button v-if="error" @click="load">重试统计</button>
    <div v-if="loading" class="quiet-empty" role="status">正在读取训练统计…</div>
    <div v-if="stats" class="statistics-content">
      <section
        v-if="weekly"
        v-show="activeSection === 'overview'"
        class="panel training-extra-panel statistics-weekly"
      >
        <div class="section-head">
          <div>
            <span class="eyebrow">WEEKLY FOCUS</span>
            <h2>本周目标</h2>
          </div>
        </div>
        <p v-if="weekly.goal">
          {{ weekly.goal.mode === 'focus' ? '专注' : '均衡' }}：{{ weekly.goal.categories.join('、') }} ·
          已安排 {{ weekly.assigned }} 道相关新题，今日 AC {{ weekly.completed }} 道。
        </p>
        <p v-else>本周尚未选择目标。<RouterLink to="/">前往今日题单选择</RouterLink></p>
        <div v-if="weekly.goal" class="tag-line">
          <span v-for="category in weekly.goal.categories" :key="category"
            >{{ category }} {{ weekly.coverage[category] ?? 0 }} 题</span
          >
        </div>
      </section>
      <section
        v-show="activeSection === 'activity' && activityPart === 'reasons'"
        class="panel training-extra-panel statistics-reasons"
      >
        <div class="section-head">
          <div>
            <span class="eyebrow">ROOT CAUSE</span>
            <h2>错因改进趋势</h2>
            <p>按保存复盘时的错因快照归集；旧复盘只计入“错因与算法分布”。</p>
          </div>
        </div>
        <div v-if="!reasonTrend.length" class="quiet-empty">新保存的错因将在这里形成每周记录。</div>
        <div v-for="week in reasonTrend" :key="week.week" class="upsolve-row">
          <strong>{{ week.week }} 起 · {{ week.samples }} 题</strong
          ><span>{{ week.reasons.map((r) => `${r.name} ${r.count}/${week.samples}`).join(' · ') }}</span>
        </div>
      </section>
      <div v-show="activeSection === 'overview'" class="metrics statistics-metrics">
        <div class="metric">
          <span>累计错题</span><strong>{{ stats.total }}<small>题</small></strong>
          <p>不含已忽略题目</p>
        </div>
        <div class="metric">
          <span>尚未 AC</span><strong>{{ stats.unsolved }}<small>题</small></strong>
          <p>等待解决的难点</p>
        </div>
        <div class="metric">
          <span>已经掌握</span><strong>{{ stats.mastered }}<small>题</small></strong>
          <p>完成五轮独立重做</p>
        </div>
        <div class="metric accent">
          <span>同步提交总数</span><strong>{{ stats.submissions }}<small>次</small></strong>
          <p>包括成功与失败的全部提交</p>
        </div>
      </div>
      <div v-show="activeSection === 'overview'" class="training-summary statistics-summary">
        <span
          >到期重做 <strong>{{ stats.due }}</strong> 题</span
        ><span
          >待写复盘 <strong>{{ stats.pending }}</strong> 题</span
        ><span
          >今日安排：复习 {{ stats.dailyTraining.at(-1)?.reviewAssigned ?? 0 }} / 新知
          {{ stats.dailyTraining.at(-1)?.newAssigned ?? 0 }}</span
        >
      </div>
      <section
        v-show="activeSection === 'overview'"
        class="panel mastery-panel statistics-mastery"
        :class="'mastery-view-' + masteryView"
      >
        <div class="section-head">
          <div>
            <span class="eyebrow">LEARNING PROFILE</span>
            <h2>算法领域掌握度</h2>
            <p>结合提交与独立重做；AtCoder 仅纳入手动标注领域的题，样本不足时向中性值收敛。</p>
          </div>
        </div>
        <div class="mastery-display-switch" role="group" aria-label="掌握度展示方式">
          <button :aria-pressed="masteryView === 'chart'" @click="masteryView = 'chart'">雷达图</button>
          <button :aria-pressed="masteryView === 'list'" @click="masteryView = 'list'">领域明细</button>
        </div>
        <div class="mastery-content">
          <svg
            class="mastery-radar"
            viewBox="0 0 320 320"
            role="img"
            aria-label="八个算法领域的掌握度雷达图"
            :data-target-scores="stats.mastery.map((area) => area.score).join(',')"
          >
            <polygon
              v-for="ring in [27.5, 55, 82.5, 110]"
              :key="ring"
              :points="radarRing(ring)"
              class="radar-ring"
            />
            <line
              v-for="i in 8"
              :key="i"
              x1="160"
              y1="160"
              :x2="radarPoint(i - 1, 110).split(',')[0]"
              :y2="radarPoint(i - 1, 110).split(',')[1]"
              class="radar-axis"
            />
            <polygon :points="radarShape" class="radar-value" />
            <circle
              v-for="(area, i) in stats.mastery"
              :key="area.name"
              :cx="radarPoint(i, radarSpring.values.value[i] * 1.1).split(',')[0]"
              :cy="radarPoint(i, radarSpring.values.value[i] * 1.1).split(',')[1]"
              r="3"
              class="radar-dot"
            >
              <title>{{ area.name }}：{{ area.score }} 分，{{ area.samples }} 题</title>
            </circle>
          </svg>
          <div class="mastery-list">
            <div v-for="area in stats.mastery" :key="area.name" class="mastery-row">
              <span>{{ area.name }}</span
              ><strong
                >{{ area.samples ? area.score : '样本不足' }}<small v-if="area.samples"> / 100</small></strong
              ><small>{{ area.samples }} 题</small>
            </div>
          </div>
        </div>
        <div class="button-row">
          <RouterLink to="/?view=path">按薄弱领域规划学习路径 →</RouterLink
          ><RouterLink to="/problems?status=pending">补充尚未完成的复盘 →</RouterLink>
        </div>
        <details class="chart-caption mastery-caption">
          <summary>查看掌握度计算口径</summary>
          <p>
            每道有明确结果的题按唯一题目计数，可计入多个算法领域。已掌握 100、最近独立做对 85、借助提示
            45、仍未做出 15；未重做时 CF AC 70、明确失败 20。领域得分 = (题目得分之和 + 3 × 50) ÷ (样本数 +
            3)，四舍五入；0 样本为 50，表示数据不足，不代表已经掌握。新知题按 1 ÷ (掌握度 + 10) 分配领域配额。
          </p>
        </details>
      </section>
      <details
        v-show="activeSection === 'activity' && activityPart === 'records'"
        class="panel daily-history statistics-history"
      >
        <summary class="section-head">
          <div>
            <span class="eyebrow">DAILY PRACTICE</span>
            <h2>最近 14 天题单</h2>
          </div>
          <span class="small subtle">展开每日完成明细</span>
        </summary>
        <div class="daily-history-grid">
          <div v-for="item in stats.dailyTraining" :key="item.date" class="daily-history-day">
            <strong>{{ item.date.slice(5).replace('-', '/') }}</strong
            ><span>复习 {{ item.reviewCompleted }}/{{ item.reviewAssigned }}</span
            ><span>新知 {{ item.newCompleted }}/{{ item.newAssigned }}</span
            ><span class="history-progress" aria-hidden="true"
              ><i
                :style="{
                  transform: `scaleX(${(item.reviewCompleted + item.newCompleted) / Math.max(1, item.reviewAssigned + item.newAssigned)})`,
                }"
              ></i
            ></span>
          </div>
        </div>
        <p class="chart-caption">复习完成按笔记完成或重做记录计算；新知完成按题单当日的 CF AC 计算。</p>
      </details>
      <section
        v-show="activeSection === 'activity' && activityPart === 'records'"
        class="panel trend-panel statistics-trend"
      >
        <div class="section-head">
          <div>
            <span class="eyebrow">CONSISTENCY MATTERS</span>
            <h2>最近 14 天的重做记录</h2>
          </div>
          <div class="legend">
            <span><i class="independent"></i>独立做对</span><span><i class="hint"></i>借助提示</span
            ><span><i class="failed"></i>仍未做出</span>
          </div>
        </div>
        <div class="trend-chart" role="img" aria-label="最近十四天重做结果柱状图">
          <div v-for="t in stats.trend" :key="t.date" class="chart-column">
            <span class="chart-value">{{ t.independent + t.hint + t.failed || '' }}</span>
            <div class="bar-area">
              <div
                class="bar-stack"
                :title="`${t.date}：独立做对 ${t.independent}，借助提示 ${t.hint}，仍未做出 ${t.failed}`"
              >
                <div class="failed" :style="{ height: (t.failed / maximum) * 160 + 'px' }"></div>
                <div class="hint" :style="{ height: (t.hint / maximum) * 160 + 'px' }"></div>
                <div class="independent" :style="{ height: (t.independent / maximum) * 160 + 'px' }"></div>
              </div>
            </div>
            <span class="chart-date">{{ t.date.slice(5).replace('-', '/') }}</span>
          </div>
        </div>
        <p class="chart-caption">每次重做计为一条记录，按本地日期归集。没有记录的日期显示为零。</p>
        <details class="chart-caption">
          <summary>查看每日重做数据表</summary>
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>独立做对</th>
                <th>借助提示</th>
                <th>仍未做出</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in stats.trend" :key="t.date">
                <th>{{ t.date }}</th>
                <td>{{ t.independent }}</td>
                <td>{{ t.hint }}</td>
                <td>{{ t.failed }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </section>
      <div
        v-show="activeSection === 'activity' && activityPart === 'distribution'"
        class="two-columns statistics-distribution"
      >
        <section
          v-for="group in [
            { title: '常见错因', sub: '从错误中找到模式', rows: stats.reasons },
            { title: '算法分布', sub: '你的错题集中在哪些领域', rows: stats.tags },
          ]"
          :key="group.title"
          class="panel distribution"
        >
          <div class="section-head">
            <div>
              <h2>{{ group.title }}</h2>
              <p>{{ group.sub }}</p>
            </div>
          </div>
          <div v-if="!group.rows.length" class="quiet-empty">暂无数据，完成导入并填写错因后查看。</div>
          <div v-for="([label, count], i) in group.rows.slice(0, 12)" :key="label" class="distribution-row">
            <span class="row-number">{{ String(i + 1).padStart(2, '0') }}</span>
            <div>
              <div class="distribution-label">
                <RouterLink
                  :to="{
                    path: '/problems',
                    query: { source, [group.title === '常见错因' ? 'reason' : 'tag']: label },
                  }"
                  >{{ label }}</RouterLink
                ><b>{{ count }} <small>题</small></b>
              </div>
              <div class="horizontal-track">
                <span :style="{ width: (count / Math.max(1, group.rows[0][1])) * 100 + '%' }"></span>
              </div>
            </div>
          </div>
          <p class="chart-caption">一道题可含多个分类，因此各项之和可能大于题目总数。</p>
        </section>
      </div>
    </div>
  </div>
</template>
