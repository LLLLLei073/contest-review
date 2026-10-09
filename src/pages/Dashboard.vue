<script setup lang="ts">
import { defineAsyncComponent, computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowRight, CalendarDays, ExternalLink, RefreshCw } from 'lucide-vue-next';
import { api, settings, job, fullDate, notify } from '../api';
import type { TrainingDay, TrainingTask } from '../../shared/training';
import type { CategoryName } from '../../shared/training';
import { useSection } from '../sections';
import { useLearningState } from '../learningState';
const LearningActivity = defineAsyncComponent(() => import('../components/LearningActivity.vue'));
import WeeklyGoalScene from '../components/WeeklyGoalScene.vue';
import GrowthHero from '../components/GrowthHero.vue';

const section = useSection(['today', 'training', 'transfers'] as const, 'today');
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
const reviewDone = computed(() => day.value?.review.filter((task) => task.completed).length ?? 0);
const newDone = computed(() => day.value?.newProblems.filter((task) => task.completed).length ?? 0);
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
  <GrowthHero />
  <div class="page-head">
    <div>
      <div class="eyebrow">YOUR DAILY PRACTICE</div>
      <h1>今日训练</h1>
      <p>复习旧题，学习新知。每栏按今天的安排保持固定。</p>
    </div>
    <span class="date-chip"><CalendarDays :size="16" />{{ date }}</span>
  </div>
  <div class="training-navigation">
    <nav class="content-switcher" aria-label="今日训练内容">
      <button :class="{ active: section === 'today' }" @click="section = 'today'">今日题单</button>
      <button :class="{ active: section === 'training' }" @click="section = 'training'">次日计划</button>
      <button :class="{ active: section === 'transfers' }" @click="section = 'transfers'">
        迁移练习 {{ pendingTransfers }}
      </button>
    </nav>
    <p v-if="section === 'today' && learning.loading.value" role="status">正在读取训练摘要…</p>
    <div v-show="section === 'today' && !learning.loading.value" class="training-shortcuts">
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
  <LearningActivity v-if="activityOpened" v-show="section !== 'today'" :mode="section" :session="learning" />
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
        <section class="panel daily-panel">
          <div class="section-head">
            <div>
              <span class="eyebrow">01 / REVIEW</span>
              <h2>
                复习 <span class="count">{{ reviewDone }}/{{ day?.review.length ?? 0 }}</span>
              </h2>
              <p>到期重做优先，不足 5 题时补入待复盘错题。</p>
            </div>
            <div
              class="daily-progress"
              role="progressbar"
              aria-label="今日复习进度"
              :aria-valuenow="reviewDone"
              aria-valuemin="0"
              :aria-valuemax="day?.review.length ?? 0"
            >
              <span
                :style="{ transform: `scaleX(${reviewDone / Math.max(1, day?.review.length ?? 0)})` }"
              ></span>
            </div>
          </div>
          <div v-if="loading && !day" class="quiet-empty">正在读取今日安排…</div>
          <div v-else-if="!day?.review.length" class="quiet-empty">
            今天没有到期或待复盘题目。<RouterLink to="/problems">查看错题库</RouterLink>
          </div>
          <article
            v-for="(task, index) in day?.review ?? []"
            :key="task.key"
            class="daily-task"
            :data-phase="task.phase"
          >
            <div class="daily-task-main">
              <span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="daily-task-content">
                <strong>{{ task.name }}</strong>
                <div class="daily-meta">
                  {{
                    task.source === 'atcoder' ? 'AtCoder · ' + task.key.slice(8) : task.key.replace(':', '')
                  }}
                  · {{ task.rating ?? '暂无难度' }} ·
                  {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}
                </div>
              </div>
              <Transition name="task-state" mode="out-in"
                ><span
                  :key="`${task.phase}:${task.redoAccepted}:${task.completed}`"
                  :class="[
                    'badge',
                    task.completed ? 'mastered' : task.phase === 'reflection' ? 'pending' : 'reviewing',
                  ]"
                  >{{
                    task.phase === 'reflection'
                      ? task.redoAccepted
                        ? '重做完成 · 待复盘'
                        : '已尝试 · 待复盘'
                      : task.phase === 'evaluation'
                        ? '重做完成 · 待评价'
                        : task.completed
                          ? task.redoAccepted
                            ? '今日 AC'
                            : '今日已尝试'
                          : '待重做'
                  }}</span
                ></Transition
              >
            </div>
            <div class="daily-actions">
              <a :href="task.url" target="_blank" rel="noreferrer" class="text-link"
                >原题 <ExternalLink :size="13"
              /></a>
              <RouterLink :to="'/problems/' + encodeURIComponent(task.key)" class="text-link"
                >{{ task.phase === 'reflection' ? '写复盘' : '查看笔记' }} <ArrowRight :size="13"
              /></RouterLink>
              <button
                v-if="task.phase === 'evaluation' || (!task.completed && task.phase !== 'reflection')"
                class="small-button"
                @click="openAttempt(task)"
              >
                {{ task.redoAccepted ? '手动评价' : '记录尝试' }}
              </button>
            </div>
            <p v-if="task.phase === 'reflection'" class="subtle small">
              保存“当时的思路、根本原因、正确解法、复杂度分析、关键反例”中的任意一项，才算完成复盘；仅选错因或保存代码不计入。
            </p>
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
          </article>
        </section>
        <section class="panel daily-panel">
          <div class="section-head">
            <div>
              <span class="eyebrow">02 / DISCOVER</span>
              <h2>
                新知 <span class="count">{{ newDone }}/{{ day?.newProblems.length ?? 0 }}</span>
              </h2>
              <p>每天最多 5 道从未提交过的 CF 题，优先安排本周目标领域。</p>
            </div>
            <div
              class="daily-progress"
              role="progressbar"
              aria-label="今日新知进度"
              :aria-valuenow="newDone"
              aria-valuemin="0"
              :aria-valuemax="day?.newProblems.length ?? 0"
            >
              <span
                :style="{ transform: `scaleX(${newDone / Math.max(1, day?.newProblems.length ?? 0)})` }"
              ></span>
            </div>
          </div>
          <div v-if="loading && !day" class="quiet-empty">正在读取公开题库…</div>
          <div v-else-if="!day?.catalogCount" class="quiet-empty">
            {{ settings.activeHandle ? '尚无完整公开题库。' : '新知题仅从 Codeforces 选择。'
            }}<RouterLink to="/settings?view=sync">请先绑定并同步 Codeforces</RouterLink
            >；已有数据仍可离线复习。
          </div>
          <div v-else-if="!day.weeklyGoal" class="quiet-empty">选择本周目标后生成今天的新知题单。</div>
          <div v-else-if="!day.newProblems.length" class="quiet-empty">
            {{ day.newShortage || '暂无符合条件的新题；今天不会用旧题凑数。' }}
          </div>
          <article v-for="(task, index) in day?.newProblems ?? []" :key="task.key" class="daily-task">
            <div class="daily-task-main">
              <span class="daily-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="daily-task-content">
                <strong>{{ task.name }}</strong>
                <div class="daily-meta">
                  {{ task.key.replace(':', '') }} · {{ task.rating ?? '暂无难度' }} ·
                  {{ task.tags.slice(0, 2).join(' / ') || '暂无标签' }}
                </div>
                <details v-if="task.recommendationReason" class="recommendation-detail small subtle">
                  <summary>推荐原因</summary>
                  <p>{{ task.recommendationReason }}</p>
                </details>
              </div>
              <Transition name="task-state" mode="out-in"
                ><span
                  :key="`${task.completed}:${task.attempted}`"
                  :class="['badge', task.completed ? 'mastered' : task.attempted ? 'pending' : 'reviewing']"
                  >{{ task.completed ? '今日 AC' : task.attempted ? '已尝试' : '未尝试' }}</span
                ></Transition
              >
            </div>
            <div class="daily-actions">
              <a :href="task.url" target="_blank" rel="noreferrer" class="text-link"
                >打开原题 <ExternalLink :size="13"
              /></a>
            </div>
          </article>
          <p v-if="day && day.catalogCount && day.newProblems.length < 5" class="daily-footnote">
            {{ day.newShortage || `符合条件的候选不足 5 道，今天安排了 ${day.newProblems.length} 道。` }}
          </p>
        </section>
      </div>
      <p class="daily-footnote">
        当天题单固定，不会在完成后补题。新知以 CF AC、复习以对应平台当天 AC
        确认；是否独立做对由你评价。<RouterLink to="/statistics"
          >查看全部训练数据 <ArrowRight :size="13"
        /></RouterLink>
      </p>
    </template>
  </div>
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
