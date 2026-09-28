<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, notify, settings } from '../api';
import type { CFContest } from '../../shared/domain';
import type { SimulationEvent } from '../../shared/training-extras';

type Report = {
  id: string;
  contestId: number;
  contestName: string;
  startedAt: string;
  durationSeconds: number;
  finishedAt: string | null;
  ended: boolean;
  solved: number;
  problems: {
    key: string;
    name: string;
    index: string;
    url: string;
    rating: number | null;
    tags: string[];
    seenBefore: boolean;
  }[];
  events: SimulationEvent[];
};
const contests = ref<CFContest[]>([]),
  sessions = ref<Report[]>([]),
  selected = ref<Report | null>(null);
const query = ref(''),
  view = ref<'choose' | 'session' | 'history'>('choose'),
  error = ref(''),
  busy = ref(false),
  now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
const available = computed(() =>
  contests.value
    .filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(query.value.toLowerCase()))
    .slice(0, 80),
);
const ended = computed(
  () =>
    !selected.value ||
    selected.value.ended ||
    now.value >= Date.parse(selected.value.startedAt) + selected.value.durationSeconds * 1000,
);
const remaining = computed(() => {
  if (!selected.value) return '—';
  const s = Math.max(
    0,
    Math.floor(
      (Date.parse(selected.value.startedAt) + selected.value.durationSeconds * 1000 - now.value) / 1000,
    ),
  );
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
});
async function load() {
  try {
    const [nextContests, nextSessions] = await Promise.all([
      api<CFContest[]>('/training/simulations/contests'),
      api<Report[]>('/training/simulations'),
    ]);
    contests.value = nextContests;
    sessions.value = nextSessions;
    selected.value = nextSessions.find((s) => s.id === selected.value?.id) ?? nextSessions[0] ?? null;
    if (selected.value && !ended.value) view.value = 'session';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function start(contestId: number) {
  busy.value = true;
  error.value = '';
  try {
    selected.value = await api<Report>('/training/simulations', { contestId });
    view.value = 'session';
    await load();
    notify('模拟赛已开始，计时在离开页面后继续');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function record(problemKey: string, verdict: 'OK' | 'FAILED') {
  if (!selected.value) return;
  busy.value = true;
  try {
    selected.value = await api<Report>(`/training/simulations/${selected.value.id}`, {
      action: 'record',
      problemKey,
      verdict,
    });
    notify('已记录手动结果');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function finish() {
  if (!selected.value || !confirm('确定提前结束本场模拟赛？')) return;
  busy.value = true;
  try {
    selected.value = await api<Report>(`/training/simulations/${selected.value.id}`, { action: 'finish' });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function checkSubmissions() {
  busy.value = true;
  try {
    await api('/training/recent', { force: true }, 'POST');
    await load();
    notify('已检查近期 CF 提交');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">CONTEST PRACTICE</div>
      <h1>CF 模拟赛</h1>
      <p>按真实时钟完成一场旧比赛，赛后回看自己的提交与手动记录。</p>
    </div>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <div v-if="!settings.activeHandle" class="panel quiet-empty">请先在设置中绑定 Codeforces 用户名。</div>
  <template v-else>
    <nav class="content-switcher" aria-label="模拟赛内容">
      <button :class="{ active: view === 'session' }" :disabled="!selected" @click="view = 'session'">
        {{ selected && !ended ? '进行中' : '本场记录' }}
      </button>
      <button :class="{ active: view === 'choose' }" @click="view = 'choose'">选择比赛</button>
      <button :class="{ active: view === 'history' }" :disabled="!sessions.length" @click="view = 'history'">
        历史场次 {{ sessions.length }}
      </button>
    </nav>
    <section v-show="view === 'choose'" class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <h2>选择已结束比赛</h2>
          <p>题集来自同步的公开目录；开始后按原比赛时长计时。</p>
        </div>
      </div>
      <input v-model="query" aria-label="搜索模拟赛" placeholder="搜索比赛名称或编号" />
      <div v-if="!contests.length" class="quiet-empty">尚无可模拟的比赛资料，请在设置中重新同步 CF。</div>
      <div class="simulation-contests">
        <button
          v-for="contest in available"
          :key="contest.id"
          class="small-button"
          :disabled="
            busy ||
            sessions.some((s) => !s.ended && Date.now() < Date.parse(s.startedAt) + s.durationSeconds * 1000)
          "
          @click="start(contest.id)"
        >
          {{ contest.name }} · #{{ contest.id }} · {{ Math.round((contest.durationSeconds ?? 0) / 60) }} 分钟
        </button>
      </div>
    </section>
    <section v-if="selected" v-show="view === 'session'" class="panel training-extra-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">{{ ended ? 'SIMULATION REPORT' : 'IN PROGRESS' }}</span>
          <h2>{{ selected.contestName }}</h2>
          <p>
            {{ ended ? '已结束' : `剩余 ${remaining}` }} · AC {{ selected.solved }}/{{
              selected.problems.length
            }}
          </p>
        </div>
        <div class="button-row">
          <button class="small-button" :disabled="busy" @click="checkSubmissions">检查 CF 提交</button>
          <button v-if="!ended" class="small-button" :disabled="busy" @click="finish">提前结束</button>
        </div>
      </div>
      <p class="small subtle">
        CF 提交仅取本次计时窗口内的当前判定；手动结果会单独标注。此处不是官方排名或 Rating。
      </p>
      <article v-for="problem in selected.problems" :key="problem.key" class="upsolve-row">
        <div>
          <a :href="problem.url" target="_blank" rel="noreferrer"
            ><strong>{{ problem.index }} · {{ problem.name }}</strong></a
          >
          <p class="small subtle">
            {{ problem.seenBefore ? '开始前已做过 · ' : ''
            }}{{
              ended
                ? `${problem.rating ?? '难度未知'} · ${problem.tags.join(' / ')}`
                : '难度与标签将在结束后显示'
            }}
          </p>
        </div>
        <div v-if="!ended" class="button-row">
          <button class="small-button" :disabled="busy" @click="record(problem.key, 'OK')">手记 AC</button>
          <button class="small-button" :disabled="busy" @click="record(problem.key, 'FAILED')">
            手记失败
          </button>
        </div>
      </article>
      <details class="report-deep-dive">
        <summary>提交时间线 · {{ selected.events.length }} 条记录</summary>
        <div v-if="!selected.events.length" class="quiet-empty">
          暂无记录。同步 CF 提交或手动记录赛中结果。
        </div>
        <div
          v-for="(event, i) in selected.events"
          :key="`${event.source}:${event.at}:${i}`"
          class="upsolve-row"
        >
          <span
            >{{ event.minute }} 分钟 · {{ event.problemKey }} · {{ event.verdict }} ·
            {{ event.source === 'cf' ? 'CF 提交' : '手动记录' }}</span
          >
          <a v-if="event.submissionUrl" :href="event.submissionUrl" target="_blank" rel="noreferrer"
            >查看提交</a
          >
        </div>
      </details>
    </section>
    <section v-if="sessions.length" v-show="view === 'history'" class="panel training-extra-panel">
      <h2>历史模拟赛</h2>
      <div class="simulation-contests">
        <button
          v-for="session in sessions"
          :key="session.id"
          class="small-button"
          @click="
            selected = session;
            view = 'session';
          "
        >
          {{ session.contestName }} · {{ new Date(session.startedAt).toLocaleDateString('zh-CN') }} · AC
          {{ session.solved }}
        </button>
      </div>
    </section>
  </template>
</template>
