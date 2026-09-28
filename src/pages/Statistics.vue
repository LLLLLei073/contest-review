<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed } from 'vue';
import { ChartNoAxesCombined } from 'lucide-vue-next';
import { api, fullDate, notify } from '../api';
import type { Statistics } from '../../shared/domain';
import type { UpsolveItem } from '../../shared/training-extras';
import type { WeeklyGoal } from '../../shared/weekly';
import { useSpringValues } from '../motion';
const stats = ref<Statistics | null>(null),
  error = ref('');
const source = ref<'all' | 'cf' | 'atcoder'>('all');
const weekly = ref<{
  goal: WeeklyGoal | null;
  assigned: number;
  completed: number;
  coverage: Record<string, number>;
} | null>(null);
const upsolve = ref<UpsolveItem[]>([]);
const reasonTrend = ref<{ week: string; samples: number; reasons: { name: string; count: number }[] }[]>([]);
const health = ref<{
  cf: { handle: string; sync: string | null; catalog: string | null; problems: number; rated: number };
  atcoder: { handle: string; sync: string | null; catalog: string | null; problems: number; rated: number };
  pendingVerdicts: number;
  lastBackup: string | null;
} | null>(null);
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
async function load() {
  try {
    const next = await api<Statistics>('/statistics?source=' + source.value);
    if (!alive) return;
    stats.value = next;
    radarSpring.setTarget(next.mastery.map((area) => area.score));
    [weekly.value, upsolve.value, reasonTrend.value, health.value] = await Promise.all([
      api<NonNullable<typeof weekly.value>>('/training/weekly'),
      api<UpsolveItem[]>('/training/upsolve'),
      api<typeof reasonTrend.value>('/training/reason-trend?source=' + source.value),
      api<NonNullable<typeof health.value>>('/training/health'),
    ]);
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  }
}
async function removeUpsolve(item: UpsolveItem) {
  await api(`/training/upsolve/${item.source}/${encodeURIComponent(item.key)}`, {}, 'DELETE');
  upsolve.value = await api('/training/upsolve');
  notify('已从补题清单移除');
}
onMounted(load);
onBeforeUnmount(() => {
  alive = false;
});
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">PROGRESS, NOT PERFECTION</div>
      <h1>训练统计</h1>
      <p>找到反复出现的问题，让下一次练习更有方向。</p>
    </div>
    <span class="date-chip"><ChartNoAxesCombined :size="17" />按唯一题目统计</span>
  </div>
  <div v-if="error" class="alert error">{{ error }}</div>
  <div class="contest-filter">
    <label
      >统计来源
      <select v-model="source" @change="load">
        <option value="all">两站合计</option>
        <option value="cf">Codeforces</option>
        <option value="atcoder">AtCoder</option>
      </select></label
    >
  </div>
  <template v-if="stats"
    ><section v-if="weekly" class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">WEEKLY FOCUS</span>
          <h2>本周目标</h2>
        </div>
      </div>
      <p v-if="weekly.goal">
        {{ weekly.goal.mode === 'focus' ? '专注' : '均衡' }}：{{ weekly.goal.categories.join('、') }} · 已安排
        {{ weekly.assigned }} 道相关新题，今日 AC {{ weekly.completed }} 道。
      </p>
      <p v-else>本周尚未选择目标。<RouterLink to="/">前往今日题单选择</RouterLink></p>
      <div v-if="weekly.goal" class="tag-line">
        <span v-for="category in weekly.goal.categories" :key="category"
          >{{ category }} {{ weekly.coverage[category] ?? 0 }} 题</span
        >
      </div>
    </section>
    <section class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">UPSOLVE</span>
          <h2>赛后补题清单</h2>
          <p>从比赛报告添加；完成状态按对应账号同步到的 AC 判断，不占固定题单名额。</p>
        </div>
      </div>
      <div v-if="!upsolve.length" class="quiet-empty">还没有补题。打开比赛报告，把未 AC 的题目加入这里。</div>
      <article v-for="item in upsolve" :key="item.source + item.key" class="upsolve-row">
        <div>
          <strong>{{ item.name }}</strong>
          <p class="small subtle">
            {{ item.source === 'cf' ? 'CF' : 'AtCoder' }} · {{ item.contestName }} ·
            {{ item.rating ?? '暂无难度' }} ·
            {{ item.completed ? '已 AC' : item.attempted ? '已尝试' : '未尝试' }}
          </p>
        </div>
        <div class="button-row">
          <a class="small-button" :href="item.url" target="_blank" rel="noreferrer">打开原题</a
          ><button class="small-button" @click="removeUpsolve(item)">移除</button>
        </div>
      </article>
    </section>
    <section class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">ROOT CAUSE</span>
          <h2>错因改进趋势</h2>
          <p>按保存复盘时的错因快照归集；旧复盘只计入上方当前分布。</p>
        </div>
      </div>
      <div v-if="!reasonTrend.length" class="quiet-empty">新保存的错因将在这里形成每周记录。</div>
      <div v-for="week in reasonTrend" :key="week.week" class="upsolve-row">
        <strong>{{ week.week }} 起 · {{ week.samples }} 题</strong
        ><span>{{ week.reasons.map((r) => `${r.name} ${r.count}/${week.samples}`).join(' · ') }}</span>
      </div>
    </section>
    <section v-if="health" class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">DATA HEALTH</span>
          <h2>数据健康</h2>
        </div>
      </div>
      <div class="health-grid">
        <p>
          CF 提交：{{ health.cf.sync ? fullDate(health.cf.sync) : '尚未同步' }}<br />题目目录
          {{ health.cf.problems }} 题，含难度 {{ health.cf.rated }} 题<br />目录更新：{{
            health.cf.catalog ? fullDate(health.cf.catalog) : '暂无数据'
          }}
        </p>
        <p>
          AtCoder 提交：{{ health.atcoder.sync ? fullDate(health.atcoder.sync) : '尚未同步' }}<br />题目目录
          {{ health.atcoder.problems }} 题，含估计难度 {{ health.atcoder.rated }} 题<br />目录更新：{{
            health.atcoder.catalog ? fullDate(health.atcoder.catalog) : '暂无数据'
          }}
        </p>
        <p>
          待判提交：{{ health.pendingVerdicts }} 条<br />上次备份导出：{{
            health.lastBackup ? fullDate(health.lastBackup) : '尚无记录'
          }}
        </p>
      </div>
      <RouterLink to="/settings" class="small-button">同步与导出备份</RouterLink>
    </section>
    <div class="metrics">
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
    <div class="training-summary">
      <span
        >到期重做 <strong>{{ stats.due }}</strong> 题</span
      ><span
        >待写复盘 <strong>{{ stats.pending }}</strong> 题</span
      ><span
        >今日安排：复习 {{ stats.dailyTraining.at(-1)?.reviewAssigned ?? 0 }} / 新知
        {{ stats.dailyTraining.at(-1)?.newAssigned ?? 0 }}</span
      >
    </div>
    <section class="panel mastery-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">LEARNING PROFILE</span>
          <h2>算法领域掌握度</h2>
          <p>结合提交与独立重做；AtCoder 仅纳入手动标注领域的题，样本不足时向中性值收敛。</p>
        </div>
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
            ><strong>{{ area.score }}<small> / 100</small></strong
            ><small>{{ area.samples }} 题</small>
          </div>
        </div>
      </div>
      <p class="chart-caption mastery-caption">
        每道有明确结果的题按唯一题目计数，可计入多个算法领域。已掌握 100、最近独立做对 85、借助提示
        45、仍未做出 15；未重做时 CF AC 70、明确失败 20。领域得分 = (题目得分之和 + 3 × 50) ÷ (样本数 +
        3)，四舍五入；0 样本为 50，表示数据不足，不代表已经掌握。新知题按 1 ÷ (掌握度 + 10) 分配领域配额。
      </p>
    </section>
    <section class="panel daily-history">
      <div class="section-head">
        <div>
          <span class="eyebrow">DAILY PRACTICE</span>
          <h2>最近 14 天题单</h2>
        </div>
      </div>
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
    </section>
    <section class="panel trend-panel">
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
    </section>
    <div class="two-columns">
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
              <span>{{ label }}</span
              ><b>{{ count }} <small>题</small></b>
            </div>
            <div class="horizontal-track">
              <span :style="{ width: (count / Math.max(1, group.rows[0][1])) * 100 + '%' }"></span>
            </div>
          </div>
        </div>
        <p class="chart-caption">一道题可含多个分类，因此各项之和可能大于题目总数。</p>
      </section>
    </div></template
  >
</template>
