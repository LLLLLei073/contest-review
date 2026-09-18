<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Flag, ArrowUpRight, Search, Save } from 'lucide-vue-next';
import type { ContestRow, ContestReview } from '../../shared/domain';
import { api, notify, job } from '../api';
import { onBeforeRouteLeave } from 'vue-router';
const rows = ref<ContestRow[]>([]),
  selected = ref<ContestRow | null>(null),
  draft = ref<ContestReview>({ timeAllocation: '', mistakes: '', improvements: '' }),
  error = ref(''),
  busy = ref(false),
  query = ref(''),
  filter = ref('all');
const dirty = computed(
  () => selected.value && JSON.stringify(draft.value) !== JSON.stringify(selected.value.review),
);
const filtered = computed(() =>
  rows.value.filter(
    (c) =>
      (c.name + ' ' + c.id).toLowerCase().includes(query.value.toLowerCase()) &&
      (filter.value === 'all' ||
        (filter.value === 'practice'
          ? !c.types.some((t) => ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(t))
          : c.types.includes(filter.value))),
  ),
);
const typeLabels: Record<string, string> = {
  CONTESTANT: '正式参赛',
  VIRTUAL: '虚拟参赛',
  PRACTICE: '练习',
  OUT_OF_COMPETITION: '非正式参赛',
  MANAGER: '管理者',
};
async function load() {
  try {
    rows.value = await api('/contests');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function choose(c: ContestRow) {
  if (dirty.value && !confirm('比赛复盘尚未保存，确定切换吗？')) return;
  selected.value = c;
  draft.value = JSON.parse(JSON.stringify(c.review));
}
async function save() {
  busy.value = true;
  try {
    const result = await api<ContestReview>(`/contests/${selected.value!.id}/review`, draft.value, 'PUT');
    selected.value!.review = result;
    notify('比赛复盘已保存');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
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
    <span class="date-chip"><Flag :size="16" />{{ rows.length }} 场关联比赛</span>
  </div>
  <div v-if="error" class="alert error">{{ error }}</div>
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
        :key="c.id"
        class="contest-item"
        :class="{ selected: selected?.id === c.id }"
        @click="choose(c)"
      >
        <div class="contest-meta">
          <span>#{{ c.id }}</span
          ><span>{{
            c.startTimeSeconds
              ? new Date(c.startTimeSeconds * 1000).toLocaleDateString('zh-CN')
              : '时间待补全'
          }}</span>
        </div>
        <h3>{{ c.name }}</h3>
        <div class="tag-line">
          <span v-for="t in c.types" :key="t">{{ typeLabels[t] || t }}</span
          ><span v-if="!c.types.length">无提交记录</span>
        </div>
        <div class="contest-bottom">
          <span>{{ c.solvedCount }} / {{ c.problemCount }} 道提交题目已通过</span
          ><span v-if="c.rating" :class="{ positive: c.rating.newRating >= c.rating.oldRating }"
            >{{ c.rating.newRating - c.rating.oldRating >= 0 ? '+' : ''
            }}{{ c.rating.newRating - c.rating.oldRating }} Rating</span
          >
        </div>
      </button>
    </section>
    <section v-if="selected" class="panel contest-editor">
      <div class="section-head">
        <div>
          <span class="eyebrow">CONTEST / {{ selected.id }}</span>
          <h2>{{ selected.name }}</h2>
        </div>
      </div>
      <div class="editor-body">
        <div
          v-if="
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
        <RouterLink class="text-link" :to="'/problems?contestId=' + selected.id"
          >查看这场比赛的错题 <ArrowUpRight :size="15"
        /></RouterLink>
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
      </div>
    </section>
    <section v-else class="panel contest-placeholder">
      <Flag :size="38" />
      <h2>选一场比赛，慢慢回看。</h2>
      <p>整理时间分配、关键失误和下一场的改进。</p>
    </section>
  </div>
</template>
