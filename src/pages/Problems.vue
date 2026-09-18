<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, Plus, ArrowLeft, ArrowRight, X, Filter } from 'lucide-vue-next';
import { api, notify, settings, job } from '../api';
import type { ProblemRow } from '../../shared/domain';
import ProblemTable from '../components/ProblemTable.vue';
const route = useRoute(),
  router = useRouter();
const filters = ref({
  q: '',
  tag: '',
  reason: '',
  status: String(route.query.status || ''),
  solved: '',
  ignored: 'no',
  min: '',
  max: '',
  due: String(route.query.due || ''),
  contestId: String(route.query.contestId || ''),
});
const items = ref<ProblemRow[]>([]),
  total = ref(0),
  page = ref(1),
  loading = ref(false),
  error = ref(''),
  tags = ref<string[]>([]),
  reasons = ref<string[]>([]),
  showAdd = ref(false),
  saving = ref(false);
const manual = ref({ contestId: '', index: '', name: '', rating: '', tags: '' });
let request = 0,
  timer: ReturnType<typeof setTimeout>;
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
    error.value = (e as Error).message;
  } finally {
    if (token === request) loading.value = false;
  }
}
async function options() {
  const data = await api<{ tags: string[]; reasons: string[] }>('/tags');
  tags.value = data.tags;
  reasons.value = data.reasons;
}
watch(
  filters,
  () => {
    page.value = 1;
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  },
  { deep: true },
);
watch(page, load);
onUnmounted(() => clearTimeout(timer));
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
    await router.push('/problems/' + encodeURIComponent(data.key));
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
    <div class="filters">
      <Filter :size="16" class="subtle" /><select v-model="filters.status" aria-label="复盘状态">
        <option value="">全部复盘状态</option>
        <option value="pending">待复盘</option>
        <option value="reviewing">复习中</option>
        <option value="mastered">已掌握</option></select
      ><select v-model="filters.solved" aria-label="AC 状态">
        <option value="">全部 AC 状态</option>
        <option value="yes">已 AC</option>
        <option value="no">未 AC</option></select
      ><select v-model="filters.tag" aria-label="算法标签">
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
    <div v-if="loading" class="loading-line" aria-label="加载中"></div>
    <ProblemTable v-if="items.length" :items="items" />
    <div v-else class="empty-state">
      <div class="empty-symbol"><Search :size="26" /></div>
      <h3>{{ loading ? '正在查找题目…' : '这里还没有匹配的题目' }}</h3>
      <p>
        {{
          settings.activeHandle
            ? '同步 Codeforces 记录，或调整筛选条件。'
            : '先绑定 Codeforces 用户名，开始建立你的错题库。'
        }}
      </p>
      <RouterLink to="/settings" class="text-link">前往设置 <ArrowRight :size="14" /></RouterLink>
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
  <div v-if="showAdd" class="modal-backdrop" @click.self="showAdd = false">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div class="section-head">
        <h2 id="add-title">添加一道题</h2>
        <button class="icon-button" aria-label="关闭" @click="showAdd = false"><X :size="20" /></button>
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
              placeholder="例如 2000" /></label
          ><label
            >题目编号<input v-model="manual.index" required pattern="[A-Za-z][0-9]*" placeholder="例如 C"
          /></label>
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
              placeholder="例如 1600" /></label
          ><label>算法标签（英文逗号分隔）<input v-model="manual.tags" placeholder="dp, greedy" /></label>
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <button class="primary" :disabled="saving">{{ saving ? '正在添加…' : '加入错题库' }}</button>
      </form>
    </section>
  </div>
</template>
