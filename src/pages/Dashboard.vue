<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ArrowRight, CalendarDays, ExternalLink, RefreshCw } from 'lucide-vue-next';
import { api, settings, job, fullDate, notify } from '../api';
import type { TrainingDay, TrainingTask } from '../../shared/training';

const day = ref<TrainingDay | null>(null);
const error = ref('');
const recentError = ref('');
const loading = ref(false);
const checking = ref(false);
const busy = ref(false);
const activeKey = ref('');
const minutes = ref(0);
const note = ref('');
const result = ref<'independent' | 'hint' | 'failed'>('independent');
const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const reviewDone = computed(() => day.value?.review.filter((task) => task.completed).length ?? 0);
const newDone = computed(() => day.value?.newProblems.filter((task) => task.completed).length ?? 0);

async function load() {
  if (!settings.value.activeHandle) { day.value = null; return; }
  const handle = settings.value.activeHandle;
  loading.value = true;
  error.value = '';
  try {
    const next = await api<TrainingDay>('/training/day');
    if (settings.value.activeHandle === handle) day.value = next;
  } catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
}
async function checkRecent() {
  if (!settings.value.activeHandle || job.value?.status === 'running') return;
  const handle = settings.value.activeHandle;
  checking.value = true;
  recentError.value = '';
  try {
    const outcome = await api<{ checkedAt: string | null; error: string | null }>('/training/recent', {}, 'POST');
    if (settings.value.activeHandle !== handle) return;
    recentError.value = outcome.error ?? '';
    await load();
  } catch (e) { recentError.value = (e as Error).message; }
  finally { checking.value = false; }
}
function openAttempt(task: TrainingTask) {
  activeKey.value = activeKey.value === task.key ? '' : task.key;
  minutes.value = 0;
  note.value = '';
  result.value = 'independent';
}
async function saveAttempt(key: string) {
  busy.value = true;
  error.value = '';
  try {
    await api('/problems/' + encodeURIComponent(key) + '/attempts', { result: result.value, minutes: minutes.value, note: note.value });
    activeKey.value = '';
    await load();
    notify('重做结果已记录，复习日期已更新');
  } catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
onMounted(() => { void load().then(checkRecent); });
watch(() => settings.value.activeHandle, () => { void load().then(checkRecent); });
watch(() => job.value?.status, (status, previous) => {
  if (status === 'completed' && previous === 'running') void load();
});
</script>

<template>
  <div class="page-head">
    <div><div class="eyebrow">YOUR DAILY PRACTICE</div><h1>今日题单</h1>
      <p>复习旧题，学习新知。每栏按今天的安排保持固定。</p></div>
    <span class="date-chip"><CalendarDays :size="16" />{{ date }}</span>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}<button @click="load">重试</button></div>
  <div v-if="!settings.activeHandle" class="welcome-card">
    <div class="welcome-art"><span>{</span><span class="art-path">WA <ArrowRight :size="22" /> AC</span><span>}</span></div>
    <div><div class="eyebrow">从你的真实提交开始</div><h2>连接 Codeforces，生成第一份题单</h2>
      <p>绑定用户名并导入公开提交后，系统会安排复习题与未做过的新题。</p>
      <RouterLink to="/settings" class="button primary">绑定 Codeforces <ArrowRight :size="16" /></RouterLink></div>
  </div>
  <template v-else>
    <div v-if="job?.status === 'running'" class="alert"><RefreshCw :size="16" class="spin" />{{ job.message }} · 已读取 {{ job.processed }} 条</div>
    <div class="training-sync">
      <span>{{ checking ? '正在检查近期提交…' : day?.recentCheckedAt ? `提交检查：${fullDate(day.recentCheckedAt)}` : '近期提交尚未检查' }}</span>
      <button class="small-button" :disabled="checking || job?.status === 'running'" @click="checkRecent"><RefreshCw :size="14" :class="{ spin: checking }" />检查提交</button>
    </div>
    <div v-if="recentError" class="alert">近期提交检查失败，继续使用已保存数据：{{ recentError }}</div>
    <div class="daily-columns">
      <section class="panel daily-panel">
        <div class="section-head"><div><span class="eyebrow">01 / REVIEW</span><h2>复习 <span class="count">{{ reviewDone }}/{{ day?.review.length ?? 0 }}</span></h2>
          <p>到期重做优先，不足 5 题时补入待复盘错题。</p></div></div>
        <div v-if="loading && !day" class="quiet-empty">正在读取今日安排…</div>
        <div v-else-if="!day?.review.length" class="quiet-empty">今天没有到期或待复盘题目。<RouterLink to="/problems">查看错题库</RouterLink></div>
        <article v-for="(task, index) in day?.review ?? []" :key="task.key" class="daily-task">
          <div class="daily-task-main"><span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="daily-task-content"><strong>{{ task.name }}</strong><div class="daily-meta">{{ task.key.replace(':', '') }} · {{ task.rating ?? '暂无难度' }} · {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}</div></div>
            <span :class="['badge', task.completed ? 'mastered' : task.kind === 'pending' ? 'pending' : 'reviewing']">{{ task.completed ? '今日完成' : task.kind === 'pending' ? '待复盘' : '到期重做' }}</span></div>
          <div class="daily-actions"><a :href="task.url" target="_blank" rel="noreferrer" class="text-link">原题 <ExternalLink :size="13" /></a>
            <RouterLink :to="'/problems/' + encodeURIComponent(task.key)" class="text-link">{{ task.kind === 'pending' ? '写复盘' : '查看笔记' }} <ArrowRight :size="13" /></RouterLink>
            <button v-if="task.kind === 'due' && !task.completed" class="small-button" @click="openAttempt(task)">记录重做</button></div>
          <form v-if="activeKey === task.key" class="daily-attempt" @submit.prevent="saveAttempt(task.key)">
            <select v-model="result" aria-label="重做结果"><option value="independent">独立做对</option><option value="hint">借助提示</option><option value="failed">仍未做出</option></select>
            <label>耗时（分钟）<input v-model.number="minutes" type="number" min="0" step="0.5" required /></label>
            <input v-model="note" aria-label="补充笔记" placeholder="补充笔记（可选）" maxlength="100000" />
            <button class="primary" :disabled="busy">保存结果</button>
          </form>
        </article>
      </section>
      <section class="panel daily-panel">
        <div class="section-head"><div><span class="eyebrow">02 / DISCOVER</span><h2>新知 <span class="count">{{ newDone }}/{{ day?.newProblems.length ?? 0 }}</span></h2>
          <p>每天 5 道从未提交过的 CF 题，按薄弱领域分配。</p></div></div>
        <div v-if="loading && !day" class="quiet-empty">正在读取公开题库…</div>
        <div v-else-if="!day?.catalogCount" class="quiet-empty">尚无完整公开题库。<RouterLink to="/settings">请先同步 Codeforces</RouterLink>；已有数据仍可离线复习。</div>
        <div v-else-if="!day.newProblems.length" class="quiet-empty">暂无符合条件的新题；今天不会用旧题凑数。</div>
        <article v-for="(task, index) in day?.newProblems ?? []" :key="task.key" class="daily-task">
          <div class="daily-task-main"><span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="daily-task-content"><strong>{{ task.name }}</strong><div class="daily-meta">{{ task.key.replace(':', '') }} · {{ task.rating ?? '暂无难度' }} · {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}</div></div>
            <span :class="['badge', task.completed ? 'mastered' : task.attempted ? 'pending' : 'reviewing']">{{ task.completed ? '今日 AC' : task.attempted ? '已尝试' : '未尝试' }}</span></div>
          <div class="daily-actions"><a :href="task.url" target="_blank" rel="noreferrer" class="text-link">打开原题 <ExternalLink :size="13" /></a></div>
        </article>
        <p v-if="day && day.catalogCount && day.newProblems.length < 5" class="daily-footnote">符合条件的候选不足 5 道，今天安排了 {{ day.newProblems.length }} 道。</p>
      </section>
    </div>
    <p class="daily-footnote">当天题单固定，不会在完成后补题。新知仅以当天 CF AC 标为完成；复习结果由你记录。<RouterLink to="/statistics">查看全部训练数据 <ArrowRight :size="13" /></RouterLink></p>
  </template>
</template>
