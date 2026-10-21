<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, Plus, ArrowLeft, ArrowRight, X, Filter } from 'lucide-vue-next';
import { api, notify, settings, job } from '../api';
import type { ProblemRow } from '../../shared/domain';
import ProblemTable from '../components/ProblemTable.vue';
import { useProblemFilters } from '../composables/useProblemFilters';
import { defaultProblemFilters, type ProblemFilters } from '../../shared/problem-filters';
const route = useRoute(),
  router = useRouter();
const { filters, page, reset } = useProblemFilters();
const items = ref<ProblemRow[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  tags = ref<string[]>([]),
  reasons = ref<string[]>([]),
  showAdd = ref(false),
  saving = ref(false);
const manual = ref({ contestId: '', index: '', name: '', rating: '', tags: '' });
const addDialog = ref<HTMLDialogElement>();
const existingProblem = ref<ProblemRow>();
const manualErrors = computed(() => ({
  contestId:
    manual.value.contestId &&
    (!Number.isSafeInteger(Number(manual.value.contestId)) || Number(manual.value.contestId) <= 0)
      ? '比赛 ID 需要为正整数'
      : '',
  index:
    manual.value.index && !/^[A-Za-z][0-9]*$/.test(manual.value.index.trim())
      ? '请输入 A、C 或 A1 这样的题号'
      : '',
  rating:
    manual.value.rating &&
    (!Number.isSafeInteger(Number(manual.value.rating)) || Number(manual.value.rating) < 0)
      ? '难度需要为非负整数'
      : '',
}));
const manualKey = computed(() =>
  !manualErrors.value.contestId &&
  !manualErrors.value.index &&
  manual.value.contestId &&
  manual.value.index.trim()
    ? `${Number(manual.value.contestId)}:${manual.value.index.trim().toUpperCase()}`
    : '',
);
let manualLookup = 0,
  manualTimer: ReturnType<typeof setTimeout> | undefined;
watch(showAdd, async (open) => {
  await nextTick();
  if (open) {
    error.value = '';
    addDialog.value?.showModal();
  } else addDialog.value?.close();
});
watch([showAdd, manualKey], ([open, key]) => {
  clearTimeout(manualTimer);
  const token = ++manualLookup;
  existingProblem.value = undefined;
  if (!open || !key) return;
  manualTimer = setTimeout(async () => {
    try {
      const result = await api<{ problem: ProblemRow }>('/problems/' + encodeURIComponent(key));
      if (token === manualLookup) existingProblem.value = result.problem;
    } catch {}
  }, 250);
});
const filterLabels: Record<keyof ProblemFilters, string> = {
  q: '搜索',
  source: '平台',
  tag: '算法',
  reason: '错因',
  status: '状态',
  solved: 'AC',
  ignored: '已忽略',
  min: '最低难度',
  max: '最高难度',
  due: '到期',
  contestId: '比赛',
};
const activeFilters = computed(() =>
  Object.entries(filters.value)
    .filter(([key, value]) => value !== defaultProblemFilters[key as keyof ProblemFilters])
    .map(([key, value]) => ({
      key: key as keyof ProblemFilters,
      label: filterLabels[key as keyof ProblemFilters],
      value,
    })),
);
const advancedCount = computed(
  () =>
    [filters.value.tag, filters.value.reason, filters.value.min, filters.value.max].filter(Boolean).length,
);
let request = 0;
let alive = true;
async function load() {
  const token = ++request;
  loading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(page.value), size: '25' });
    Object.entries(filters.value).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const data = await api<{ items: ProblemRow[]; total: number }>('/problems?' + qs);
    if (token === request) {
      items.value = data.items;
      total.value = data.total;
      error.value = '';
    }
  } catch (e) {
    if (token === request) error.value = (e as Error).message;
  } finally {
    if (token === request) loading.value = false;
  }
}
async function options() {
  const data = await api<{ tags: string[]; reasons: string[] }>('/tags');
  if (!alive) return;
  tags.value = data.tags;
  reasons.value = data.reasons;
}
watch(
  () => route.fullPath,
  () => {
    if (route.path === '/problems') void load();
  },
);
onUnmounted(() => {
  request++;
  alive = false;
  manualLookup++;
  clearTimeout(manualTimer);
});
watch(
  () => job.value?.status,
  (s, p) => {
    if (s === 'completed' && p === 'running') {
      void load();
      options().catch((e) => (error.value = e.message));
    }
  },
);
onMounted(() => {
  void load();
  options().catch((e) => (error.value = e.message));
});
async function add() {
  if (Object.values(manualErrors.value).some(Boolean)) return;
  if (existingProblem.value) {
    await router.push({
      path: '/problems/' + encodeURIComponent(existingProblem.value.key),
      query: { returnTo: route.fullPath },
    });
    return;
  }
  saving.value = true;
  try {
    const data = await api<{ key: string }>('/problems', {
      contestId: Number(manual.value.contestId),
      index: manual.value.index,
      name: manual.value.name,
      rating: manual.value.rating ? Number(manual.value.rating) : null,
      tags: manual.value.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    notify('题目已加入错题库');
    await router.push({
      path: '/problems/' + encodeURIComponent(data.key),
      query: { returnTo: route.fullPath },
    });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">YOUR PROBLEM NOTEBOOK</div>
      <h1>
        错题库<span class="heading-count">{{ total }}</span>
      </h1>
      <p>留下失败的轨迹，也留下理解的过程。</p>
    </div>
    <button class="primary" :disabled="!settings.activeHandle" @click="showAdd = true">
      <Plus :size="17" />手动添加
    </button>
  </div>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <nav class="button-row notebook-presets" aria-label="常用题目视图">
    <button class="small-button" @click="reset({ due: 'yes' })">到期复习</button>
    <button class="small-button" @click="reset({ status: 'pending' })">待写复盘</button>
    <button class="small-button" @click="reset({ solved: 'no' })">尚未通过</button>
    <button class="small-button" @click="reset({ ignored: 'yes' })">找回已忽略题目</button>
  </nav>
  <div v-if="activeFilters.length" class="active-filter-chips" aria-label="已启用的筛选">
    <button
      v-for="filter in activeFilters"
      :key="filter.key"
      class="small-button"
      @click="filters[filter.key] = defaultProblemFilters[filter.key]"
    >
      {{ filter.label }}：{{ filter.value }} <X :size="12" />
    </button>
    <button class="text-link" @click="reset()">清空全部筛选</button>
  </div>
  <p v-if="filters.ignored === 'yes'" class="alert">
    忽略只会移出训练队列，笔记和历史仍然保留。打开题目后点击“恢复此题”即可重新加入。
  </p>
  <section class="panel">
    <div class="filter-top">
      <label class="search-field"
        ><Search :size="18" /><input
          v-model="filters.q"
          aria-label="搜索题目"
          placeholder="搜索题目名称、题号…"
      /></label>
      <div class="segmented">
        <button :class="{ selected: filters.ignored === 'no' }" @click="filters.ignored = 'no'">
          我的错题</button
        ><button :class="{ selected: filters.ignored === 'yes' }" @click="filters.ignored = 'yes'">
          已忽略
        </button>
      </div>
    </div>
    <div class="filters filters-primary">
      <Filter :size="16" class="subtle" /><select v-model="filters.source" aria-label="题目来源">
        <option value="all">两站全部</option>
        <option value="cf">Codeforces</option>
        <option value="atcoder">AtCoder</option></select
      ><select v-model="filters.status" aria-label="复盘状态">
        <option value="">全部复盘状态</option>
        <option value="pending">待复盘</option>
        <option value="reviewing">复习中</option>
        <option value="mastered">已掌握</option></select
      ><select v-model="filters.solved" aria-label="AC 状态">
        <option value="">全部 AC 状态</option>
        <option value="yes">已 AC</option>
        <option value="no">未 AC</option>
      </select>
      <button
        v-if="filters.due || filters.contestId"
        class="text-link"
        @click="
          filters.due = '';
          filters.contestId = '';
        "
      >
        清除{{ filters.due ? '到期' : '比赛' }}筛选 <X :size="14" />
      </button>
    </div>
    <details class="advanced-filters" :open="Boolean(advancedCount)">
      <summary>
        更多筛选<span v-if="advancedCount"> · 已启用 {{ advancedCount }} 项</span>
      </summary>
      <div class="filters">
        <select v-model="filters.tag" aria-label="算法标签">
          <option value="">全部算法</option>
          <option v-for="t in tags" :key="t">{{ t }}</option></select
        ><select v-model="filters.reason" aria-label="错因">
          <option value="">全部错因</option>
          <option v-for="r in reasons" :key="r">{{ r }}</option>
        </select>
        <div class="rating-range">
          <input
            v-model="filters.min"
            type="number"
            aria-label="最低难度"
            placeholder="最低难度"
            min="0"
          /><span>—</span
          ><input v-model="filters.max" type="number" aria-label="最高难度" placeholder="最高难度" min="0" />
        </div>
      </div>
    </details>
    <div v-if="loading" class="loading-line" aria-label="加载中"></div>
    <ProblemTable v-if="items.length" :items="items" :return-to="route.fullPath" />
    <div v-else class="empty-state">
      <div class="empty-symbol"><Search :size="26" /></div>
      <h3>{{ loading ? '正在查找题目…' : '这里还没有匹配的题目' }}</h3>
      <p>
        {{
          settings.activeHandle || settings.activeAtcoder
            ? '同步对应平台的记录，或调整筛选条件。'
            : '先绑定用户名，开始建立你的错题库。'
        }}
      </p>
      <RouterLink
        :to="
          settings.activeHandle || settings.activeAtcoder ? '/settings?view=sync' : '/settings?view=accounts'
        "
        class="text-link"
        >前往设置 <ArrowRight :size="14"
      /></RouterLink>
    </div>
    <div class="pagination">
      <span>共 {{ total }} 题 · 每页 25 题</span>
      <div>
        <button :disabled="page <= 1" aria-label="上一页" @click="page--"><ArrowLeft :size="15" /></button
        ><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 25)) }}</span
        ><button :disabled="page * 25 >= total" aria-label="下一页" @click="page++">
          <ArrowRight :size="15" />
        </button>
      </div>
    </div>
  </section>
  <dialog
    ref="addDialog"
    class="manual-dialog"
    aria-labelledby="add-title"
    @close="showAdd = false"
    @cancel="
      (event) => {
        if (saving) event.preventDefault();
      }
    "
  >
    <section class="modal">
      <div class="section-head">
        <h2 id="add-title">添加一道题</h2>
        <button class="icon-button" aria-label="关闭" :disabled="saving" @click="showAdd = false">
          <X :size="20" />
        </button>
      </div>
      <p class="subtle">用于补充未提交过、但希望复盘的 Codeforces 题目。</p>
      <form @submit.prevent="add">
        <div class="form-grid">
          <label
            >比赛 ID<input
              v-model="manual.contestId"
              required
              type="number"
              min="1"
              :aria-invalid="!!manualErrors.contestId"
              placeholder="例如 2000"
            /><small v-if="manualErrors.contestId" class="unsaved">{{ manualErrors.contestId }}</small></label
          >
          <label
            >题目编号<input
              v-model="manual.index"
              required
              pattern="[A-Za-z][0-9]*"
              :aria-invalid="!!manualErrors.index"
              placeholder="例如 C"
            /><small v-if="manualErrors.index" class="unsaved">{{ manualErrors.index }}</small></label
          >
        </div>
        <label
          >题目名称<input v-model="manual.name" required maxlength="1000" placeholder="题目标题"
        /></label>
        <div class="form-grid">
          <label
            >难度（选填）<input
              v-model="manual.rating"
              type="number"
              min="0"
              :aria-invalid="!!manualErrors.rating"
              placeholder="例如 1600"
            /><small v-if="manualErrors.rating" class="unsaved">{{ manualErrors.rating }}</small></label
          >
          <label>算法标签（英文逗号分隔）<input v-model="manual.tags" placeholder="dp, greedy" /></label>
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <p v-if="existingProblem" class="alert">
          这道题已存在：{{ existingProblem.name }}。已有笔记与历史将保留，可直接打开继续。
        </p>
        <button v-if="existingProblem" type="button" class="primary" @click="add">打开已有题目</button>
        <button v-else class="primary" :disabled="saving || Object.values(manualErrors).some(Boolean)">
          {{ saving ? '正在添加…' : '加入错题库' }}
        </button>
      </form>
    </section>
  </dialog>
</template>
<style scoped>
.manual-dialog {
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
  color: var(--ink);
  width: min(620px, calc(100vw - 28px));
  max-height: calc(100dvh - 36px);
}
.manual-dialog::backdrop {
  background: #101a2b88;
}
.manual-dialog .modal {
  width: 100%;
  max-width: none;
  border: 0;
  max-height: none;
}
.active-filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
}
.notebook-presets {
  margin: 0 0 16px;
}
</style>
