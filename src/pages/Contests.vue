<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Flag, ArrowUpRight, Search, Save, RefreshCw } from 'lucide-vue-next';
import type { ContestReview, CFRating } from '../../shared/domain';
import type { BatchJob } from '../../shared/xcpc';
import { api, notify, job, settings, loadSettings } from '../api';
import ContestReport from '../components/ContestReport.vue';
import XcpcReport from '../components/XcpcReport.vue';
import { onBeforeRouteLeave } from 'vue-router';
type ContestView = {
  source: 'cf' | 'xcpc';
  key: string;
  id: number | string;
  name: string;
  startTimeSeconds?: number;
  types: string[];
  review: ContestReview;
  inContestSolved: number | null;
  analysisStatus: string;
  analysisScore: number | null;
  performanceRating?: number | null;
  performanceBound?: 'lower' | 'upper' | null;
  rating?: CFRating;
  teamName?: string;
  tier?: string;
};
const rows = ref<ContestView[]>([]),
  selected = ref<ContestView | null>(null),
  draft = ref<ContestReview>({ timeAllocation: '', mistakes: '', improvements: '' }),
  error = ref(''),
  busy = ref(false),
  query = ref(''),
  filter = ref('all'),
  batch = ref<BatchJob | null>(null),
  batchBusy = ref(false);
let batchTimer: ReturnType<typeof setInterval> | undefined;
let batchPolling = false;
const dirty = computed(
  () => selected.value && JSON.stringify(draft.value) !== JSON.stringify(selected.value.review),
);
const filtered = computed(() =>
  rows.value.filter(
    (c) =>
      (c.name + ' ' + c.id).toLowerCase().includes(query.value.toLowerCase()) &&
      (filter.value === 'all' ||
        (filter.value === 'xcpc' && c.source === 'xcpc') ||
        (filter.value === 'cf' && c.source === 'cf') ||
        (filter.value === 'practice'
          ? c.source === 'cf' &&
            !c.types.some((t) => ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(t))
          : c.types.includes(filter.value))),
  ),
);
const typeLabels: Record<string, string> = {
  CONTESTANT: '正式参赛',
  VIRTUAL: '虚拟参赛',
  PRACTICE: '练习',
  OUT_OF_COMPETITION: '非正式参赛',
  MANAGER: '管理者',
  XCPC_OFFICIAL: 'XCPC 正式',
  XCPC_STARRED: 'XCPC 打星',
};
const tierLabels: Record<string, string> = {
  final: '总决赛',
  regional: '区域赛',
  invitational: '邀请赛',
  provincial: '省赛',
};
async function load() {
  try {
    rows.value = await api('/review/contests');
    if (selected.value) selected.value = rows.value.find((r) => r.key === selected.value?.key) ?? null;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function choose(c: ContestView) {
  if (dirty.value && !confirm('比赛复盘尚未保存，确定切换吗？')) return;
  selected.value = c;
  draft.value = JSON.parse(JSON.stringify(c.review));
}
async function save() {
  busy.value = true;
  try {
    const c = selected.value!;
    const path =
      c.source === 'cf'
        ? `/contests/${c.id}/review`
        : `/xcpc/contests/${encodeURIComponent(String(c.id))}/review`;
    const result = await api<ContestReview>(path, draft.value, 'PUT');
    selected.value!.review = result;
    notify('比赛复盘已保存');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function loadBatch() {
  try {
    const next = await api<BatchJob | null>('/review/batch');
    const wasPolling = batchPolling;
    batch.value = next ? structuredClone(next) : null;
    batchPolling = next?.status === 'running';
    if (wasPolling && !batchPolling) await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function oneClick() {
  batchBusy.value = true;
  error.value = '';
  try {
    batchPolling = true;
    batch.value = structuredClone(await api<BatchJob>('/review/batch', {}));
    notify('一键复盘已开始，可查看进度');
  } catch (e) {
    batchPolling = false;
    error.value = (e as Error).message;
  } finally {
    batchBusy.value = false;
  }
}
async function stopBatch() {
  try {
    await api('/review/batch/stop', {});
    notify('正在安全停止');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function setMode(mode: 'official' | 'all') {
  try {
    await api('/xcpc/mode', { mode });
    await loadSettings();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  void load();
  void loadBatch();
  batchTimer = setInterval(() => {
    if (batchPolling) void loadBatch();
  }, 1500);
});
onBeforeUnmount(() => clearInterval(batchTimer));
watch(
  () => job.value?.status,
  (s, p) => {
    if (s === 'completed' && p === 'running') void load();
  },
);
onBeforeRouteLeave(() => !dirty.value || confirm('比赛复盘尚未保存，确定离开吗？'));
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">LOOK BACK, MOVE FORWARD</div>
      <h1>比赛复盘</h1>
      <p>不只看最后的排名，也看每一个决策。</p>
    </div>
    <div class="button-row">
      <button
        class="primary"
        :disabled="
          batchBusy || batch?.status === 'running' || (!settings.activeHandle && !settings.xcpcPlayer)
        "
        @click="oneClick"
      >
        <RefreshCw :size="16" />一键复盘全部待复盘比赛</button
      ><span class="date-chip"><Flag :size="16" />{{ rows.length }} 场关联比赛</span>
    </div>
  </div>
  <div v-if="error" class="alert error">{{ error }}</div>
  <div v-if="batch" :class="['alert', { error: batch.status === 'failed' }]" role="status">
    {{ batch.phase }} · 已处理 {{ batch.processed }} / {{ batch.total }} · 成功 {{ batch.succeeded }} · 失败
    {{ batch.failed }} <button v-if="batch.status === 'running'" @click="stopBatch">停止</button>
    <details v-if="batch.errors.length">
      <summary>查看失败项</summary>
      <p v-for="e in batch.errors" :key="e">{{ e }}</p>
    </details>
  </div>
  <div v-if="settings.xcpcPlayer" class="contest-filter">
    <label
      >XCPC 表现分口径
      <select
        :value="settings.xcpcMode || 'official'"
        @change="setMode(($event.target as HTMLSelectElement).value as 'official' | 'all')"
      >
        <option value="official">仅正式参赛</option>
        <option value="all">所有参赛（含打星）</option>
      </select></label
    >
  </div>
  <div class="contest-layout">
    <section class="panel contest-list">
      <div class="filter-top">
        <label class="search-field"
          ><Search :size="17" /><input v-model="query" aria-label="搜索比赛" placeholder="搜索比赛名称或编号"
        /></label>
      </div>
      <div class="contest-filter">
        <select v-model="filter" aria-label="参赛类型">
          <option value="all">全部关联比赛</option>
          <option value="cf">Codeforces</option>
          <option value="xcpc">XCPC Rating</option>
          <option value="CONTESTANT">正式参赛</option>
          <option value="VIRTUAL">虚拟参赛</option>
          <option value="practice">仅练习 / 无参赛记录</option>
        </select>
      </div>
      <div v-if="!filtered.length" class="empty-state">
        <Flag :size="28" />
        <h3>还没有关联比赛</h3>
        <p>同步提交记录后，比赛会自动归集。</p>
      </div>
      <button
        v-for="c in filtered"
        :key="c.key"
        class="contest-item"
        :class="{ selected: selected?.key === c.key }"
        @click="choose(c)"
      >
        <div class="contest-meta">
          <span>{{ c.source === 'cf' ? 'CF #' + c.id : 'XCPC' }}</span
          ><span>{{
            c.startTimeSeconds
              ? new Date(c.startTimeSeconds * 1000).toLocaleDateString('zh-CN')
              : '时间待补全'
          }}</span>
        </div>
        <h3>{{ c.name }}</h3>
        <div class="tag-line">
          <span v-for="t in c.types" :key="t">{{ typeLabels[t] || t }}</span
          ><span v-if="c.source === 'xcpc' && c.tier">{{ tierLabels[c.tier] || c.tier }}</span
          ><span v-if="!c.types.length">无提交记录</span>
        </div>
        <div class="contest-bottom">
          <span
            >{{ c.source === 'cf' ? '赛时 AC' : '队伍解题' }} {{ c.inContestSolved ?? '—' }} ·
            {{
              c.source === 'cf' && c.performanceRating !== null && c.performanceRating !== undefined
                ? `预估 CF 表现分 ${c.performanceBound === 'upper' ? '≥' : c.performanceBound === 'lower' ? '≤' : ''}${c.performanceRating} · 综合复盘分 ${c.analysisScore === null ? '—' : `${c.analysisScore}/100`}`
                : `${c.analysisStatus}${c.analysisScore === null ? '' : ` ${c.analysisScore}`}`
            }}</span
          ><span v-if="c.rating" :class="{ positive: c.rating.newRating >= c.rating.oldRating }"
            >{{ c.rating.newRating - c.rating.oldRating >= 0 ? '+' : ''
            }}{{ c.rating.newRating - c.rating.oldRating }} Rating</span
          >
        </div>
      </button>
    </section>
    <Transition name="report-switch" mode="out-in"
      ><section v-if="selected" :key="selected.key" class="panel contest-editor">
        <div class="section-head">
          <div>
            <span class="eyebrow"
              >{{ selected.source === 'cf' ? 'CODEFORCES' : 'XCPC RATING' }} / {{ selected.id }}</span
            >
            <h2>{{ selected.name }}</h2>
          </div>
        </div>
        <div class="editor-body">
          <div
            v-if="
              selected.source === 'cf' &&
              selected.types.length &&
              !selected.types.some((t) => ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(t))
            "
            class="alert"
          >
            这场比赛只有练习记录，不计为正式或虚拟参赛。
          </div>
          <p v-if="selected.rating" class="subtle">
            评级变化：{{ selected.rating.oldRating }} → {{ selected.rating.newRating }} · 评级结算排名 #{{
              selected.rating.rank
            }}
          </p>
          <RouterLink
            v-if="selected.source === 'cf'"
            class="text-link"
            :to="'/problems?contestId=' + selected.id"
            >查看这场比赛的错题 <ArrowUpRight :size="15"
          /></RouterLink>
          <ContestReport
            v-if="selected.source === 'cf'"
            :key="`${settings.activeHandle}:${selected.id}:${batch?.id}:${batch?.status}`"
            :contest-id="Number(selected.id)"
            @updated="load"
          />
          <XcpcReport
            v-else
            :key="`${settings.xcpcPlayer?.key}:${selected.id}:${settings.xcpcMode}:${batch?.id}:${batch?.status}`"
            :slug="String(selected.id)"
            @updated="load"
          />
          <details class="manual-contest-notes" open>
            <summary>补充笔记 · 保留我的复盘</summary>
            <form @submit.prevent="save">
              <label
                >时间分配<textarea
                  v-model="draft.timeAllocation"
                  rows="5"
                  placeholder="在哪道题停留太久？是否及时切换思路？"
                ></textarea></label
              ><label
                >关键失误<textarea
                  v-model="draft.mistakes"
                  rows="5"
                  placeholder="记录读题、实现、策略或心态上的失误。"
                ></textarea></label
              ><label
                >下一场的改进<textarea
                  v-model="draft.improvements"
                  rows="5"
                  placeholder="把反思变成具体可执行的动作。"
                ></textarea>
              </label>
              <div class="editor-actions">
                <span class="small subtle">{{ dirty ? '有未保存的修改' : '内容已保存' }}</span
                ><button class="primary" :disabled="busy"><Save :size="15" />保存比赛复盘</button>
              </div>
            </form>
          </details>
        </div>
      </section>
      <section v-else class="panel contest-placeholder">
        <Flag :size="38" />
        <h2>选一场比赛，慢慢回看。</h2>
        <p>自动分析赛时表现、提交节奏和下一场的行动建议。</p>
      </section></Transition
    >
  </div>
</template>
