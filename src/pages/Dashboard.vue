<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, Clock3, Plus, RefreshCw } from 'lucide-vue-next';
import { api, settings, job, localDate } from '../api';
import type { ProblemRow, Statistics } from '../../shared/domain';
import ProblemTable from '../components/ProblemTable.vue';
const stats = ref<Statistics | null>(null),
  due = ref<ProblemRow[]>([]),
  pending = ref<ProblemRow[]>([]),
  error = ref(''),
  loading = ref(true);
const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const overdue = computed(
  () =>
    due.value.filter(
      (p) => p.review.nextReview && localDate(p.review.nextReview) < localDate(new Date().toISOString()),
    ).length,
);
async function load() {
  try {
    const [s, d, p] = await Promise.all([
      api<Statistics>('/statistics'),
      api<{ items: ProblemRow[] }>('/problems?due=yes&size=8'),
      api<{ items: ProblemRow[] }>('/problems?status=pending&size=5'),
    ]);
    stats.value = s;
    due.value = d.items;
    pending.value = p.items;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(
  () => job.value?.status,
  (s, p) => {
    if (s === 'completed' && p === 'running') void load();
  },
);
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">YOUR DAILY PRACTICE</div>
      <h1>把错题，解成自己的。</h1>
      <p>从一次认真复盘开始，让每次练习都有回响。</p>
    </div>
    <span class="date-chip"><CalendarDays :size="16" />{{ date }}</span>
  </div>
  <div v-if="error" class="alert error">{{ error }}<button @click="load">重试</button></div>
  <div v-if="!settings.activeHandle" class="welcome-card">
    <div class="welcome-art">
      <span>{</span><span class="art-path">WA <ArrowRight :size="22" /> AC</span><span>}</span>
    </div>
    <div>
      <div class="eyebrow">从你的真实提交开始</div>
      <h2>连接 Codeforces，整理你的第一本错题集</h2>
      <p>输入用户名，导入全部公开历史。题目、失败记录和比赛自动归集，复盘由你完成。</p>
      <RouterLink to="/settings" class="button primary">绑定 Codeforces <ArrowRight :size="16" /></RouterLink>
    </div>
  </div>
  <div v-if="job?.status === 'running'" class="alert">
    <RefreshCw :size="16" class="spin" />{{ job.message }} · 已读取 {{ job.processed }} 条
  </div>
  <div class="metrics">
    <div class="metric">
      <span>今日待重做 <Clock3 :size="17" /></span><strong>{{ stats?.due ?? '—' }}<small>题</small></strong>
      <p>{{ overdue ? `当前列表中 ${overdue} 题已逾期` : '按自己的节奏，逐题巩固' }}</p>
    </div>
    <div class="metric">
      <span>等待复盘 <Plus :size="17" /></span><strong>{{ stats?.pending ?? '—' }}<small>题</small></strong>
      <p>写下错因，让问题变得具体</p>
    </div>
    <div class="metric">
      <span>已经掌握 <CheckCheck :size="17" /></span
      ><strong>{{ stats?.mastered ?? '—' }}<small>题</small></strong>
      <p>经过多轮独立重做验证</p>
    </div>
    <div class="metric accent">
      <span>我的错题集 <ArrowUpRight :size="17" /></span
      ><strong>{{ stats?.total ?? '—' }}<small>题</small></strong
      ><RouterLink to="/problems">打开完整错题库 <ArrowRight :size="14" /></RouterLink>
    </div>
  </div>
  <section class="panel">
    <div class="section-head">
      <div>
        <span class="eyebrow">01 / REVISIT</span>
        <h2>
          今天，再解一次 <span class="count">{{ stats?.due ?? 0 }}</span>
        </h2>
      </div>
      <RouterLink to="/problems?due=yes" class="text-link">查看全部 <ArrowRight :size="15" /></RouterLink>
    </div>
    <ProblemTable v-if="due.length" :items="due" />
    <div v-else class="empty-state">
      <div class="empty-symbol"><CheckCheck :size="28" /></div>
      <h3>{{ loading ? '正在读取复习安排…' : '今天没有到期的复习' }}</h3>
      <p>完成一题复盘后，它会在明天进入重做清单。</p>
      <RouterLink to="/problems" class="text-link">去整理一道错题 <ArrowRight :size="14" /></RouterLink>
    </div>
  </section>
  <div class="dashboard-bottom">
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">02 / REFLECT</span>
          <h2>还没想透的题</h2>
        </div>
        <RouterLink to="/problems?status=pending" class="text-link"
          >全部 <ArrowUpRight :size="15"
        /></RouterLink>
      </div>
      <div v-if="!pending.length" class="quiet-empty">
        待复盘题目会出现在这里。先导入记录，或手动添加一道题。
      </div>
      <RouterLink
        v-for="(p, i) in pending"
        :key="p.key"
        :to="'/problems/' + encodeURIComponent(p.key)"
        class="pending-row"
        ><span class="row-number">0{{ i + 1 }}</span>
        <div>
          <strong>{{ p.name }}</strong
          ><small>{{ p.contestId }}{{ p.index }} · {{ p.tags[0] || '待整理标签' }}</small>
        </div>
        <span class="badge pending">待复盘</span><ArrowUpRight :size="16"
      /></RouterLink>
    </section>
    <aside class="practice-note">
      <span class="eyebrow">复盘小记 / 001</span>
      <h2>AC 是一个结果，<br />理解才是收获。</h2>
      <p>试着在不看题解的情况下，解释你的解法为什么正确。把最容易忽略的边界，写成一个具体的反例。</p>
      <div class="note-bottom">THINK. WRITE. SOLVE AGAIN.<span>↗</span></div>
    </aside>
  </div>
</template>
