<script setup lang="ts">
import { defineAsyncComponent, computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowRight, CalendarDays, RefreshCw } from 'lucide-vue-next';
import { api, settings, job, fullDate, notify } from '../api';
import type { TrainingDay, TrainingTask } from '../../shared/training';
import type { CategoryName } from '../../shared/training';
import { useSection } from '../sections';
import { useLearningState } from '../learningState';
const LearningActivity = defineAsyncComponent(() => import('../components/LearningActivity.vue'));
const PlanningWorkspace = defineAsyncComponent(() => import('../components/training/PlanningWorkspace.vue'));
import WeeklyGoalScene from '../components/WeeklyGoalScene.vue';
import GrowthHero from '../components/GrowthHero.vue';
import TrainingLane from '../components/training/TrainingLane.vue';
import NextAction from '../components/training/NextAction.vue';

const section = useSection(['today', 'training', 'transfers', 'path'] as const, 'today');
const learning = useLearningState();
const activityOpened = ref(section.value !== 'today');
watch(section, () => {
  if (section.value !== 'today') activityOpened.value = true;
});
const pendingTransfers = computed(
  () =>
    learning.state.value?.records.filter((r) => r.kind === 'transfer' && r.result === 'pending').length ?? 0,
);
const latestRevision = computed(() =>
  learning.state.value?.records.filter((r) => r.kind === 'revision').at(-1),
);
const day = ref<TrainingDay | null>(null);
const error = ref('');
const recentError = ref('');
const loading = ref(false);
const planLoadingNotice = ref(false);
const summaryLoadingNotice = ref(false);
let planNoticeTimer: ReturnType<typeof setTimeout> | undefined;
let summaryNoticeTimer: ReturnType<typeof setTimeout> | undefined;
watch(loading, (pending) => {
  clearTimeout(planNoticeTimer);
  planLoadingNotice.value = false;
  if (pending && !day.value) planNoticeTimer = setTimeout(() => (planLoadingNotice.value = true), 300);
});
watch(learning.loading, (pending) => {
  clearTimeout(summaryNoticeTimer);
  summaryLoadingNotice.value = false;
  if (pending && !learning.state.value)
    summaryNoticeTimer = setTimeout(() => (summaryLoadingNotice.value = true), 300);
});
const checking = ref(false);
const busy = ref(false);
const activeKey = ref('');
const minutes = ref(0);
const note = ref('');
const result = ref<'independent' | 'hint' | 'failed'>('independent');
const goalMode = ref<'focus' | 'balanced'>('focus');
const goalCategories = ref<CategoryName[]>([]);
const goalEditing = ref(false);
const goalError = ref('');
const goalSaving = ref(false);
const goalReveal = ref(false);
const date = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
let atcoderTimer: ReturnType<typeof setInterval> | undefined;
let previousAtcoderStatus = '';
let loadSerial = 0;
let goalSerial = 0;
let revealTimer: ReturnType<typeof setTimeout> | undefined;

async function load() {
  const serial = ++loadSerial;
  if (!settings.value.activeHandle && !settings.value.activeAtcoder) {
    day.value = null;
    loading.value = false;
    return false;
  }
  const handle = `${settings.value.activeHandle}:${settings.value.activeAtcoder}`;
  loading.value = true;
  error.value = '';
  try {
    const next = await api<TrainingDay>('/training/day');
    if (
      serial === loadSerial &&
      `${settings.value.activeHandle}:${settings.value.activeAtcoder}` === handle
    ) {
      day.value = next;
      if (next.weeklyGoal && !goalEditing.value) {
        goalMode.value = next.weeklyGoal.mode;
        goalCategories.value = next.weeklyGoal.categories as CategoryName[];
      } else if (!next.weeklyGoal && !goalEditing.value) goalCategories.value = [];
      return true;
    }
    return false;
  } catch (e) {
    if (serial === loadSerial) error.value = (e as Error).message;
    return false;
  } finally {
    if (serial === loadSerial) loading.value = false;
  }
}
async function checkRecent(force = false) {
  if ((!settings.value.activeHandle && !settings.value.activeAtcoder) || job.value?.status === 'running')
    return;
  const handle = `${settings.value.activeHandle}:${settings.value.activeAtcoder}`;
  checking.value = true;
  recentError.value = '';
  try {
    const outcome = await api<{ checkedAt: string | null; error: string | null }>(
      '/training/recent',
      { force },
      'POST',
    );
    if (`${settings.value.activeHandle}:${settings.value.activeAtcoder}` !== handle) return;
    recentError.value = outcome.error ?? '';
    await load();
  } catch (e) {
    recentError.value = (e as Error).message;
  } finally {
    checking.value = false;
  }
}
function openGoal() {
  goalMode.value = day.value?.weeklyGoal?.mode ?? 'focus';
  goalCategories.value = (day.value?.weeklyGoal?.categories ?? []) as CategoryName[];
  goalError.value = '';
  goalEditing.value = true;
}
function closeGoal() {
  if (!goalSaving.value) goalEditing.value = false;
}
async function saveGoal(value: { mode: 'focus' | 'balanced'; categories: CategoryName[] }) {
  if (goalSaving.value) return;
  const serial = ++goalSerial;
  const handle = `${settings.value.activeHandle}:${settings.value.activeAtcoder}`;
  goalSaving.value = true;
  goalError.value = '';
  try {
    await api('/training/weekly', value, 'PUT');
    if (serial !== goalSerial || `${settings.value.activeHandle}:${settings.value.activeAtcoder}` !== handle)
      return;
    const refreshed = await load();
    if (!refreshed) throw new Error('目标已保存，但题单读取失败。请重试以刷新今日安排。');
    if (serial !== goalSerial || `${settings.value.activeHandle}:${settings.value.activeAtcoder}` !== handle)
      return;
    goalMode.value = value.mode;
    goalCategories.value = value.categories;
    goalEditing.value = false;
    goalReveal.value = true;
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => (goalReveal.value = false), 520);
    notify('本周训练目标已保存');
  } catch (e) {
    if (serial === goalSerial) goalError.value = (e as Error).message;
  } finally {
    if (serial === goalSerial) goalSaving.value = false;
  }
}
function openAttempt(task: TrainingTask) {
  activeKey.value = activeKey.value === task.key ? '' : task.key;
  minutes.value = 0;
  note.value = '';
  result.value = task.redoAccepted ? 'independent' : 'hint';
}
async function saveAttempt(key: string) {
  busy.value = true;
  error.value = '';
  try {
    await api('/problems/' + encodeURIComponent(key) + '/attempts', {
      result: result.value,
      minutes: minutes.value,
      note: note.value,
    });
    activeKey.value = '';
    await load();
    notify('结果已记录，复习日期已更新');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (section.value === 'today') void load().then(() => checkRecent());
  void learning.load();
  atcoderTimer = setInterval(async () => {
    if (!settings.value.activeAtcoder) return;
    try {
      const current = await api<{ status: string } | null>('/atcoder/sync');
      if (
        section.value === 'today' &&
        current?.status === 'completed' &&
        previousAtcoderStatus === 'running'
      ) {
        await load();
        await learning.load();
      }
      previousAtcoderStatus = current?.status ?? '';
    } catch {}
  }, 2500);
});
watch(section, (value) => {
  if (value === 'today' && !day.value) void load().then(() => checkRecent());
});
onUnmounted(() => {
  goalSerial++;
  clearTimeout(planNoticeTimer);
  clearTimeout(summaryNoticeTimer);
  clearTimeout(revealTimer);
  clearInterval(atcoderTimer);
});
watch(
  () => `${settings.value.activeHandle}:${settings.value.activeAtcoder}`,
  () => {
    goalSerial++;
    goalSaving.value = false;
    goalEditing.value = false;
    goalReveal.value = false;
    clearTimeout(revealTimer);
    goalError.value = '';
    goalCategories.value = [];
    void load().then(() => checkRecent());
  },
);
watch(
  () => job.value?.status,
  (status, previous) => {
    if (status === 'completed' && previous === 'running') void load();
  },
);
</script>

<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">YOUR DAILY PRACTICE</div>
      <h1>今日训练</h1>
      <p>复习旧题，学习新知。每栏按今天的安排保持固定。</p>
    </div>
    <div class="button-row"><RouterLink to="/battle" class="button primary">开始连战 →</RouterLink><span class="date-chip"><CalendarDays :size="16" />{{ date }}</span></div>
  </div>
  <div class="training-navigation">
    <nav class="content-switcher" aria-label="今日训练内容">
      <button :class="{ active: section === 'today' }" @click="section = 'today'">今日题单</button>
      <button :class="{ active: section === 'training' }" @click="section = 'training'">次日计划</button>
      <button :class="{ active: section === 'path' }" @click="section = 'path'">学习路径</button>
      <button :class="{ active: section === 'transfers' }" @click="section = 'transfers'">
        迁移练习 {{ pendingTransfers }}
      </button>
    </nav>
    <p v-if="section === 'today' && summaryLoadingNotice" role="status">正在读取训练摘要…</p>
    <div v-show="section === 'today'" class="training-shortcuts" :aria-busy="learning.loading.value">
      <RouterLink to="/?view=training"
        >次日计划：{{
          latestRevision?.kind === 'revision'
            ? latestRevision.reverted
              ? '已撤回'
              : latestRevision.date + ' 已调整'
            : '沿用规则推荐'
        }}
        →</RouterLink
      >
      <RouterLink to="/?view=transfers">待验证迁移 {{ pendingTransfers }} 项 →</RouterLink>
    </div>
  </div>
  <PlanningWorkspace
    v-if="section === 'path' || section === 'training'"
    :mode="section === 'path' ? 'path' : 'plan'"
  />
  <LearningActivity
    v-if="activityOpened"
    v-show="section === 'training' || section === 'transfers'"
    :mode="section"
    :session="learning"
  />
  <div v-show="section === 'today'">
    <div v-if="error" class="alert error" role="alert">{{ error }}<button @click="load">重试</button></div>
    <div v-if="!settings.activeHandle && !settings.activeAtcoder" class="welcome-card">
      <div class="welcome-art">
        <span>{</span><span class="art-path">WA <ArrowRight :size="22" /> AC</span><span>}</span>
      </div>
      <div>
        <div class="eyebrow">从你的真实提交开始</div>
        <h2>连接 Codeforces，生成第一份题单</h2>
        <p>绑定用户名并导入公开提交后，系统会安排复习题与未做过的新题。</p>
        <RouterLink to="/settings?view=accounts&platform=cf" class="button primary"
          >绑定 Codeforces <ArrowRight :size="16"
        /></RouterLink>
      </div>
    </div>
    <template v-else>
      <NextAction
        :day="day"
        :cf="!!settings.activeHandle"
        :atcoder="!!settings.activeAtcoder"
        @goal="openGoal"
      />
      <div class="daily-tools">
        <section v-if="settings.activeHandle" class="panel weekly-goal">
          <div class="section-head">
            <div>
              <span class="eyebrow">WEEKLY FOCUS</span>
              <h2>本周训练目标</h2>
              <p v-if="day?.weeklyGoal">
                {{ day.weeklyGoal.mode === 'focus' ? '专注' : '均衡' }} ·
                {{ day.weeklyGoal.categories.join('、') }}。每天至少 2 道相关新题。
              </p>
              <p v-else>请选择本周方向，再生成今天的新知题单。复习题照常可做。</p>
            </div>
            <button class="small-button" @click="openGoal">
              {{ day?.weeklyGoal ? '调整目标' : '选择目标' }}
            </button>
          </div>
        </section>
        <div v-if="job?.status === 'running'" class="alert">
          <RefreshCw :size="16" class="spin" />{{ job.message }} · 已读取 {{ job.processed }} 条
        </div>
        <div class="training-sync">
          <span>{{
            checking
              ? '正在检查近期提交…'
              : day?.recentCheckedAt
                ? `提交检查：${fullDate(day.recentCheckedAt)}`
                : '近期提交尚未检查'
          }}</span>
          <button
            class="small-button"
            :disabled="checking || job?.status === 'running'"
            @click="checkRecent(true)"
          >
            <RefreshCw :size="14" :class="{ spin: checking }" />检查提交
          </button>
        </div>
      </div>
      <div v-if="recentError" class="alert">近期提交检查失败，继续使用已保存数据：{{ recentError }}</div>
      <div class="daily-columns" :class="{ 'goal-day-reveal': goalReveal }">
        <TrainingLane
          lane="review"
          :day="day"
          :loading="loading"
          :plan-loading-notice="planLoadingNotice"
          :cf="!!settings.activeHandle"
          @attempt="openAttempt"
        >
          <template #attempt="{ task }">
            <form v-if="activeKey === task.key" class="daily-attempt" @submit.prevent="saveAttempt(task.key)">
              <select v-model="result" aria-label="重做结果">
                <option value="independent" :disabled="!task.redoAccepted">独立做对（需当天 AC）</option>
                <option value="hint">借助提示</option>
                <option value="failed">仍未做出</option>
              </select>
              <label
                >耗时（分钟）<input v-model.number="minutes" type="number" min="0" step="0.5" required
              /></label>
              <input v-model="note" aria-label="补充笔记" placeholder="补充笔记（可选）" maxlength="100000" />
              <button class="primary" :disabled="busy">保存结果</button>
            </form>
          </template>
        </TrainingLane>
        <TrainingLane
          lane="new"
          :day="day"
          :loading="loading"
          :plan-loading-notice="planLoadingNotice"
          :cf="!!settings.activeHandle"
        />
      </div>
      <p class="daily-footnote">
        当天题单固定，不会在完成后补题。新知以 CF AC、复习以对应平台当天 AC
        确认；是否独立做对由你评价。<RouterLink to="/statistics"
          >查看全部训练数据 <ArrowRight :size="13"
        /></RouterLink>
      </p>
    </template>
  </div>
  <GrowthHero v-if="section === 'today'" />
  <Teleport to="body">
    <Transition name="goal-scene">
      <WeeklyGoalScene
        v-if="goalEditing"
        :mode="goalMode"
        :categories="goalCategories"
        :saving="goalSaving"
        :error="goalError"
        :existing="!!day?.weeklyGoal"
        @cancel="closeGoal"
        @confirm="saveGoal"
      />
    </Transition>
  </Teleport>
</template>
