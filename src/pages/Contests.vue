<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { Flag, ArrowUpRight, Search, Save, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import type { ContestReview, CFRating } from '../../shared/domain';
import type { BatchJob } from '../../shared/xcpc';
import { api, notify, job, settings, loadSettings } from '../api';
import ContestReport from '../components/ContestReport.vue';
import XcpcReport from '../components/XcpcReport.vue';
import AtcoderReport from '../components/AtcoderReport.vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
type ContestView = {
  source: 'cf' | 'xcpc' | 'atcoder';
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
  officialPerformance?: number | null;
  officialPlace?: number | null;
  officialRated?: boolean | null;
  rating?: CFRating;
  teamName?: string;
  tier?: string;
};
const route = useRoute(),
  router = useRouter();
const routeValue = (key: string) => (typeof route.query[key] === 'string' ? String(route.query[key]) : '');
const pageSize = 20;
const rows = ref<ContestView[]>([]),
  selected = ref<ContestView | null>(null),
  draft = ref<ContestReview>({ timeAllocation: '', mistakes: '', improvements: '' }),
  error = ref(''),
  busy = ref(false),
  query = ref(routeValue('q')),
  sourceFilter = ref(routeValue('source') || 'all'),
  yearFilter = ref(routeValue('year') || 'all'),
  typeFilter = ref(routeValue('type') || 'all'),
  page = ref(Math.max(1, Number(routeValue('page')) || 1)),
  mobileShowingReport = ref(Boolean(routeValue('contest'))),
  batch = ref<BatchJob | null>(null),
  batchBusy = ref(false);
let batchTimer: ReturnType<typeof setInterval> | undefined;
let batchPolling = false;
const dirty = computed(
  () => selected.value && JSON.stringify(draft.value) !== JSON.stringify(selected.value.review),
);
const years = computed(() =>
  [
    ...new Set(
      rows.value.map((c) =>
        c.startTimeSeconds ? new Date(c.startTimeSeconds * 1000).getFullYear().toString() : 'unknown',
      ),
    ),
  ].sort((a, b) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : Number(b) - Number(a))),
);
const filtered = computed(() =>
  rows.value.filter(
    (c) =>
      (c.name + ' ' + c.id).toLowerCase().includes(query.value.toLowerCase()) &&
      (sourceFilter.value === 'all' || c.source === sourceFilter.value) &&
      (yearFilter.value === 'all' ||
        (c.startTimeSeconds ? new Date(c.startTimeSeconds * 1000).getFullYear().toString() : 'unknown') ===
          yearFilter.value) &&
      (typeFilter.value === 'all' ||
        (typeFilter.value === 'practice'
          ? (c.source === 'cf' &&
              !c.types.some((t) => ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(t))) ||
            (c.source === 'atcoder' && c.types.includes('PRACTICE'))
          : c.types.includes(typeFilter.value) ||
            (typeFilter.value === 'CONTESTANT' && c.types.includes('ATCODER_OFFICIAL')))),
  ),
);
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const selectedIndex = computed(() => filtered.value.findIndex((c) => c.key === selected.value?.key));
let locationWrite = Promise.resolve();
function syncLocation() {
  locationWrite = locationWrite
    .then(async () => {
      await router.replace({
        query: {
          ...route.query,
          source: sourceFilter.value === 'all' ? undefined : sourceFilter.value,
          year: yearFilter.value === 'all' ? undefined : yearFilter.value,
          type: typeFilter.value === 'all' ? undefined : typeFilter.value,
          q: query.value || undefined,
          page: page.value === 1 ? undefined : String(page.value),
          contest: selected.value?.key || undefined,
        },
      });
    })
    .catch(() => {});
}
watch([query, sourceFilter, yearFilter, typeFilter], () => {
  page.value = 1;
  syncLocation();
});
watch(page, () => {
  syncLocation();
  void nextTick(() => {
    const list = document.querySelector('.contest-list-results');
    if (list) list.scrollTop = 0;
  });
});
watch(pageCount, (count) => {
  if (page.value > count) page.value = count;
});
const typeLabels: Record<string, string> = {
  CONTESTANT: '正式参赛',
  VIRTUAL: '虚拟参赛',
  PRACTICE: '练习',
  OUT_OF_COMPETITION: '非正式参赛',
  MANAGER: '管理者',
  XCPC_OFFICIAL: 'XCPC 正式',
  XCPC_STARRED: 'XCPC 打星',
  ATCODER_WINDOW: '赛时提交记录',
  ATCODER_OFFICIAL: 'AtCoder 正式参赛',
  ATCODER_UNKNOWN: '参赛身份待核实',
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
    const key = selected.value?.key || routeValue('contest');
    selected.value = rows.value.find((r) => r.key === key) ?? null;
    if (selected.value && !draft.value.timeAllocation && !draft.value.mistakes && !draft.value.improvements)
      draft.value = { ...selected.value.review };
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function choose(c: ContestView): boolean {
  if (selected.value?.key === c.key) {
    mobileShowingReport.value = true;
    void nextTick(focusSelectedReport);
    return true;
  }
  if (dirty.value && !confirm('比赛复盘尚未保存，确定切换吗？')) return false;
  selected.value = c;
  draft.value = { ...c.review };
  mobileShowingReport.value = true;
  syncLocation();
  return true;
}
function focusSelectedReport() {
  if (window.innerWidth > 650) return;
  const heading = document.querySelector<HTMLElement>('.contest-editor h2');
  heading?.focus({ preventScroll: true });
  heading?.scrollIntoView({ block: 'start' });
}
function returnToList() {
  mobileShowingReport.value = false;
  void nextTick(() => document.querySelector<HTMLElement>('.contest-list input')?.focus());
}
function adjacent(direction: -1 | 1) {
  const next = filtered.value[selectedIndex.value + direction];
  if (!next) return;
  if (choose(next)) page.value = Math.floor(selectedIndex.value / pageSize) + 1;
}
async function save() {
  busy.value = true;
  try {
    const c = selected.value!;
    const path =
      c.source === 'cf'
        ? `/contests/${c.id}/review`
        : c.source === 'atcoder'
          ? `/atcoder/contests/${encodeURIComponent(String(c.id))}/review`
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
async function addUpsolve() {
  if (!selected.value || selected.value.source === 'xcpc') return;
  busy.value = true;
  try {
    const items = await api<{ key: string }[]>('/training/upsolve/contest', {
      source: selected.value.source,
      contestId: String(selected.value.id),
    });
    notify(items.length ? `已将 ${items.length} 道未 AC 题加入补题清单` : '本场题目已全部 AC');
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
          batchBusy ||
          batch?.status === 'running' ||
          (!settings.activeHandle && !settings.xcpcPlayer && !settings.activeAtcoder)
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
  <div class="contest-layout" :class="{ 'mobile-report-open': mobileShowingReport && selected }">
    <section class="panel contest-list" aria-label="比赛列表">
      <div class="filter-top">
        <label class="search-field"
          ><Search :size="17" /><input v-model="query" aria-label="搜索比赛" placeholder="搜索比赛名称或编号"
        /></label>
      </div>
      <div class="contest-source-tabs" role="group" aria-label="比赛平台">
        <button
          v-for="source in [
            { value: 'all', label: '全部' },
            { value: 'cf', label: 'CF' },
            { value: 'atcoder', label: 'AtCoder' },
            { value: 'xcpc', label: 'XCPC' },
          ]"
          :key="source.value"
          type="button"
          :aria-pressed="sourceFilter === source.value"
          :class="{ active: sourceFilter === source.value }"
          @click="sourceFilter = source.value"
        >
          {{ source.label }}
        </button>
      </div>
      <div class="contest-filter contest-filter-grid">
        <select v-model="yearFilter" aria-label="比赛年份">
          <option value="all">所有年份</option>
          <option v-for="year in years" :key="year" :value="year">
            {{ year === 'unknown' ? '时间待补全' : year + ' 年' }}
          </option>
        </select>
        <select v-model="typeFilter" aria-label="参赛类型">
          <option value="all">所有类型</option>
          <option value="CONTESTANT">正式参赛</option>
          <option value="VIRTUAL">虚拟参赛</option>
          <option value="practice">仅练习 / 无参赛记录</option>
        </select>
      </div>
      <p class="contest-result-count" aria-live="polite">
        找到 {{ filtered.length }} 场<span v-if="filtered.length"> · 第 {{ page }} / {{ pageCount }} 页</span>
      </p>
      <div class="contest-list-results">
        <div v-if="!filtered.length" class="empty-state">
          <Flag :size="28" />
          <h3>{{ rows.length ? '没有符合条件的比赛' : '还没有关联比赛' }}</h3>
          <p>{{ rows.length ? '试试其他年份、平台或关键词。' : '同步提交记录后，比赛会自动归集。' }}</p>
        </div>
        <button
          v-for="c in pageRows"
          :key="c.key"
          class="contest-item"
          :class="{ selected: selected?.key === c.key }"
          :aria-pressed="selected?.key === c.key"
          @click="choose(c)"
        >
          <div class="contest-meta">
            <span>{{ c.source === 'cf' ? 'CF #' + c.id : c.source === 'atcoder' ? 'AtCoder' : 'XCPC' }}</span
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
              >{{ c.source === 'xcpc' ? '队伍解题' : '赛时 AC' }} {{ c.inContestSolved ?? '—' }} ·
              {{
                c.source === 'cf' && c.performanceRating !== null && c.performanceRating !== undefined
                  ? `预估 CF 表现分 ${c.performanceBound === 'upper' ? '≥' : c.performanceBound === 'lower' ? '≤' : ''}${c.performanceRating} · 综合复盘分 ${c.analysisScore === null ? '—' : `${c.analysisScore}/100`}`
                  : c.source === 'atcoder' && c.officialPlace !== null && c.officialPlace !== undefined
                    ? `官方排名 #${c.officialPlace} · 官方 Performance ${c.officialPerformance ?? '暂无数据'}`
                    : `${c.analysisStatus}${c.analysisScore === null ? '' : ` ${c.analysisScore}`}`
              }}</span
            ><span v-if="c.rating" :class="{ positive: c.rating.newRating >= c.rating.oldRating }"
              >{{ c.rating.newRating - c.rating.oldRating >= 0 ? '+' : ''
              }}{{ c.rating.newRating - c.rating.oldRating }} Rating</span
            >
          </div>
        </button>
      </div>
      <div v-if="filtered.length > pageSize" class="contest-pagination">
        <button
          type="button"
          class="small-button"
          :disabled="page <= 1"
          aria-label="上一页比赛"
          @click="page--"
        >
          <ChevronLeft :size="15" />上一页
        </button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button
          type="button"
          class="small-button"
          :disabled="page >= pageCount"
          aria-label="下一页比赛"
          @click="page++"
        >
          下一页<ChevronRight :size="15" />
        </button>
      </div>
    </section>
    <Transition name="report-switch" mode="out-in" @after-enter="focusSelectedReport"
      ><section v-if="selected" :key="selected.key" class="panel contest-editor">
        <div class="contest-report-navigation">
          <button class="small-button contest-back" type="button" @click="returnToList">返回比赛列表</button>
          <span v-if="selectedIndex >= 0" class="small subtle"
            >当前结果 {{ selectedIndex + 1 }} / {{ filtered.length }}</span
          >
          <div class="button-row">
            <button class="small-button" type="button" :disabled="selectedIndex <= 0" @click="adjacent(-1)">
              <ChevronLeft :size="15" />上一场
            </button>
            <button
              class="small-button"
              type="button"
              :disabled="selectedIndex < 0 || selectedIndex >= filtered.length - 1"
              @click="adjacent(1)"
            >
              下一场<ChevronRight :size="15" />
            </button>
          </div>
        </div>
        <div class="section-head">
          <div>
            <span class="eyebrow"
              >{{
                selected.source === 'cf'
                  ? 'CODEFORCES'
                  : selected.source === 'atcoder'
                    ? 'ATCODER'
                    : 'XCPC RATING'
              }}
              / {{ selected.id }}</span
            >
            <h2 tabindex="-1">{{ selected.name }}</h2>
          </div>
          <button v-if="selected.source !== 'xcpc'" class="small-button" :disabled="busy" @click="addUpsolve">
            未 AC 题加入补题清单
          </button>
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
          <AtcoderReport
            v-else-if="selected.source === 'atcoder'"
            :key="`${settings.activeAtcoder}:${selected.id}:${batch?.id}:${batch?.status}`"
            :contest-id="String(selected.id)"
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
