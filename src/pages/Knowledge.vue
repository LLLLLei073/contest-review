<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, notify, settings } from '../api';
import { useLearningState } from '../learningState';
import { useSection } from '../sections';
import Markdown from '../components/Markdown.vue';
import KnowledgeReader from '../components/knowledge/KnowledgeReader.vue';
import KnowledgeGraph from '../components/knowledge/KnowledgeGraph.vue';
import { categoryNames } from '../../shared/training';
import { matchesKnowledgeQuery, normalizeKnowledgeQuery } from '../../shared/knowledge';
import {
  experienceRevision,
  readExperienceDraft,
  writeExperienceDraft,
  removeExperienceDraft,
  type ExperienceDraft,
} from '../knowledge-drafts';
import type { LearningService } from '../../shared/learning-service';
import type { ExperienceCard, Citation } from '../../shared/learning-domain';
const route = useRoute();
const router = useRouter();
const session = useLearningState();
const { state, busy, error, message, run } = session;
const graph = ref<ReturnType<LearningService['graph']>>();
const section = useSection(['library', 'ask', 'graph'] as const, 'library');
const query = ref(''),
  results = ref<Citation[]>([]),
  question = ref('');
const selected = ref<ExperienceCard>(),
  category = ref('all'),
  focus = ref('');
const cardStatus = ref('all');
const routeNotice = ref('');
const searchLoading = ref(false),
  searchError = ref(''),
  searchedQuery = ref('');
const drafts = ref(new Map<string, ExperienceDraft>());
const selectedBase = ref<ExperienceCard>();
const draftError = ref('');
const conflictReviewed = ref(false);
let changingEditor = false;
const storage = () => window.localStorage;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const records = computed(() => state.value?.records ?? []);
const cards = computed(() =>
  records.value.filter((r): r is ExperienceCard & { sourceValid: boolean } => r.kind === 'card'),
);
const confirmedCount = computed(() => cards.value.filter((c) => c.confirmed && c.sourceValid).length);
const allKnowledge = computed(() => state.value?.knowledge ?? []);
const pendingDrafts = computed(() => cards.value.filter((c) => drafts.value.has(c.id)));
const savedSelection = computed(() => cards.value.find((c) => c.id === selected.value?.id));
const editConflict = computed(
  () =>
    !!(
      selectedBase.value &&
      savedSelection.value &&
      experienceRevision(selectedBase.value) !== experienceRevision(savedSelection.value)
    ),
);
const hasLocalEdit = computed(() => !!selected.value && drafts.value.has(selected.value.id));
const linkedKnowledge = (card: ExperienceCard) =>
  allKnowledge.value.filter((k) => card.knowledgeIds.includes(k.id));
const filteredCards = computed(() =>
  cards.value.filter((c) => {
    const knowledge = linkedKnowledge(c);
    return (
      (cardStatus.value === 'all' ||
        (cardStatus.value === 'stale' && !c.sourceValid) ||
        (cardStatus.value === 'confirmed' && c.confirmed && c.sourceValid) ||
        (cardStatus.value === 'draft' && !c.confirmed)) &&
      (category.value === 'all' || knowledge.some((k) => k.category === category.value)) &&
      matchesKnowledgeQuery(
        c.title + ' ' + c.content,
        query.value,
        knowledge.flatMap((k) => [k.title, k.category, ...k.aliases, ...k.tags]),
      )
    );
  }),
);
const library = computed(() =>
  allKnowledge.value.filter(
    (k) =>
      (category.value === 'all' || k.category === category.value) &&
      matchesKnowledgeQuery(k.title + ' ' + k.content, query.value, [k.category, ...k.aliases, ...k.tags]),
  ),
);
const owner = () =>
  JSON.stringify([
    settings.value.activeHandle,
    settings.value.activeAtcoder ?? '',
    settings.value.xcpcPlayer?.key ?? '',
  ]);
let graphSerial = 0,
  searchSerial = 0,
  alive = true;
const graphLoading = ref(false);
onBeforeUnmount(() => {
  alive = false;
  graphSerial++;
  searchSerial++;
});
function clearSearch() {
  searchSerial++;
  results.value = [];
  searchedQuery.value = '';
  searchError.value = '';
  searchLoading.value = false;
}
function clearFilters() {
  query.value = '';
  category.value = 'all';
  cardStatus.value = 'all';
  clearSearch();
}
function forgetDraft(id: string) {
  drafts.value.delete(id);
  draftError.value = removeExperienceDraft(storage, owner(), id);
}
function rememberEdit() {
  if (changingEditor || !selected.value || !selectedBase.value) return;
  const card = selected.value;
  if (experienceRevision(card) === experienceRevision(selectedBase.value)) {
    if (drafts.value.has(card.id)) forgetDraft(card.id);
    return;
  }
  const draft: ExperienceDraft = { version: 1, base: copy(selectedBase.value), card: copy(card) };
  drafts.value.set(card.id, draft);
  draftError.value = writeExperienceDraft(storage, owner(), draft);
}
function setEditor(card?: ExperienceCard, base?: ExperienceCard) {
  changingEditor = true;
  selectedBase.value = base ? copy(base) : undefined;
  selected.value = card ? copy(card) : undefined;
  conflictReviewed.value = false;
  changingEditor = false;
}
async function clearExperienceRoute(id: string) {
  if (route.path === '/knowledge' && route.query.experience === id) {
    const next = { ...route.query };
    delete next.experience;
    await router.replace({ path: '/knowledge', query: next });
  }
}
async function openExperience(id: string) {
  if (!alive) return;
  const card = cards.value.find((c) => c.id === id);
  if (!card) {
    setEditor();
    routeNotice.value = '经验卡不存在或已删除，请从个人经验卡列表重新选择。';
    section.value = 'library';
    return;
  }
  if (selected.value?.id !== id) {
    const draft = drafts.value.get(id);
    setEditor(draft?.card ?? card, draft?.base ?? card);
    // A previously checked box cannot confirm a changed or deleted source.
    if (!card.sourceValid && selected.value) selected.value.confirmed = false;
  }
  routeNotice.value = '';
  section.value = 'library';
  await nextTick();
  if (alive)
    document.getElementById('experience-editor')?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
async function navigateExperience(id: string) {
  await router.push({ path: '/knowledge', query: { ...route.query, view: 'library', experience: id } });
  await openExperience(id);
}
async function load() {
  await session.load();
  if (!alive || error.value) return;
  if (typeof route.query.experience === 'string') await openExperience(route.query.experience);
  revealCard();
}
function revealCard() {
  const id = route.query.card;
  if (typeof id !== 'string' || !allKnowledge.value.length) return;
  if (!allKnowledge.value.some((c) => c.id === id)) {
    routeNotice.value = '知识点不存在，已显示当前可用的知识目录。';
    return;
  }
  routeNotice.value = '';
  if (!library.value.some((c) => c.id === id)) {
    query.value = '';
    category.value = 'all';
  }
}
async function loadGraph() {
  const serial = ++graphSerial,
    scope = owner();
  graphLoading.value = true;
  error.value = '';
  try {
    const next = await api<ReturnType<LearningService['graph']>>('/learning/graph');
    if (alive && serial === graphSerial && scope === owner()) graph.value = next;
  } catch (e) {
    if (alive && serial === graphSerial && scope === owner()) error.value = (e as Error).message;
  } finally {
    if (alive && serial === graphSerial) graphLoading.value = false;
  }
}
async function search() {
  const term = normalizeKnowledgeQuery(query.value);
  if (!term) {
    clearSearch();
    return;
  }
  const serial = ++searchSerial,
    scope = owner();
  searchLoading.value = true;
  searchError.value = '';
  results.value = [];
  searchedQuery.value = '';
  try {
    const next = await api<Citation[]>('/learning/search', { query: term });
    if (alive && serial === searchSerial && scope === owner()) {
      results.value = next;
      searchedQuery.value = term;
    }
  } catch (e) {
    if (alive && serial === searchSerial && scope === owner()) searchError.value = (e as Error).message;
  } finally {
    if (alive && serial === searchSerial) searchLoading.value = false;
  }
}
async function saveCard() {
  if (!selected.value || !selectedBase.value || (editConflict.value && !conflictReviewed.value)) return;
  const card = copy(selected.value),
    base = copy(selectedBase.value),
    scope = owner();
  const result = await run('card', card);
  if (result?.kind === 'card' && alive && scope === owner()) {
    const current = drafts.value.get(card.id);
    if (current && experienceRevision(current.card) === experienceRevision(card)) forgetDraft(card.id);
    else if (current && experienceRevision(current.base) === experienceRevision(base)) {
      // Rebase later keystrokes on the version that just finished saving.
      const next = { ...current, base: copy(result) };
      drafts.value.set(card.id, next);
      draftError.value = writeExperienceDraft(storage, scope, next);
    }
    if (selected.value?.id === card.id) {
      if (experienceRevision(selected.value) === experienceRevision(card)) {
        setEditor();
        await clearExperienceRoute(card.id);
      } else {
        selectedBase.value = copy(result);
        rememberEdit();
      }
    }
    clearSearch();
    notify('经验卡已保存');
  }
}
async function closeEdit(discard = false) {
  const id = selected.value?.id;
  if (!id) return;
  if (discard) forgetDraft(id);
  setEditor();
  await clearExperienceRoute(id);
}
function useSavedVersion() {
  const card = savedSelection.value;
  if (!card) return;
  forgetDraft(card.id);
  setEditor(card, card);
  if (!card.sourceValid && selected.value) selected.value.confirmed = false;
}
async function updateCard(action: 'draft' | 'delete', card: ExperienceCard) {
  const scope = owner();
  const result = await run(
    action,
    action === 'delete' ? { id: card.id } : { problemKey: card.problemKey, sourceId: card.sourceId },
  );
  if (result && alive && scope === owner()) {
    clearSearch();
    if (action === 'delete') {
      forgetDraft(card.id);
      if (selected.value?.id === card.id) setEditor();
      await clearExperienceRoute(card.id);
    }
  }
}
async function askAbout(value: string) {
  question.value = value;
  section.value = 'ask';
  await nextTick();
  document.getElementById('knowledge-question')?.focus();
}
onMounted(() => {
  void load();
});
watch(query, clearSearch, { flush: 'sync' });
watch(selected, rememberEdit, { deep: true, flush: 'sync' });
watch(cards, (current) => {
  for (const card of current) {
    if (drafts.value.has(card.id)) continue;
    const result = readExperienceDraft(storage, owner(), card.id);
    if (result.error) draftError.value = result.error;
    if (result.draft) {
      // A response may have been committed before the browser was closed.
      if (experienceRevision(result.draft.card) === experienceRevision(card)) forgetDraft(card.id);
      else drafts.value.set(card.id, result.draft);
    }
  }
});
watch(
  () => (savedSelection.value ? experienceRevision(savedSelection.value) : ''),
  () => {
    conflictReviewed.value = false;
  },
);
watch(
  () => [savedSelection.value?.id, savedSelection.value?.sourceValid] as const,
  ([id, valid], [previousId, previousValid]) => {
    if (id === selected.value?.id && valid === false && (previousId !== id || previousValid !== false)) {
      selected.value!.confirmed = false;
    }
  },
);
watch(
  () => route.query.card,
  () => {
    if (route.query.card) {
      revealCard();
      section.value = 'library';
    }
  },
);
watch(
  section,
  (value) => {
    if (value === 'graph') void loadGraph();
  },
  { immediate: true },
);
watch(
  () => route.query.experience,
  (id) => {
    if (typeof id === 'string' && state.value) void openExperience(id);
    else if (!id) setEditor();
  },
);
watch(owner, () => {
  clearSearch();
  setEditor();
  drafts.value.clear();
  draftError.value = '';
  graph.value = undefined;
  state.value = undefined;
  graphSerial++;
  routeNotice.value = '';
  void load();
  if (section.value === 'graph') void loadGraph();
});
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">LEARN / CONNECT / VERIFY</div>
      <h1>知识中心</h1>
      <RouterLink class="astra-context-link" to="/companion">与星澪讨论知识</RouterLink>
      <p class="subtle">从算法原理出发，连接自己的复盘，再用练习验证。</p>
    </div>
  </div>
  <div v-if="error" role="alert" class="alert error">
    {{ error }} <button @click="section === 'graph' ? loadGraph() : load()">重试</button>
  </div>
  <p v-if="session.loading.value" role="status">正在读取知识与经验…</p>
  <p v-if="graphLoading" role="status">正在读取知识图谱…</p>
  <div v-if="message" role="status" class="alert">{{ message }}</div>
  <p v-if="routeNotice" role="status" class="alert">{{ routeNotice }}</p>
  <nav class="content-switcher learning-tabs" aria-label="知识中心内容">
    <button
      v-for="s in [
        { id: 'library', label: '知识与经验' },
        { id: 'ask', label: '算法问答' },
        { id: 'graph', label: '知识图谱' },
      ]"
      :key="s.id"
      :class="{ active: section === s.id }"
      @click="section = s.id"
    >
      {{ s.label }}
    </button>
  </nav>
  <p v-if="state && !state.configured" class="alert knowledge-ai-note">
    未配置 AI。仍可浏览知识卡、搜索个人资料和查看历史；生成内容请先到<RouterLink to="/settings?view=ai"
      >设置与数据</RouterLink
    >配置接口。
  </p>
  <section v-show="section === 'library'" class="learning-stack">
    <div class="panel knowledge-discovery">
      <div class="knowledge-overview">
        <div>
          <span class="eyebrow">YOUR ALGORITHM LIBRARY</span>
          <h2>知识与经验库</h2>
        </div>
        <p>
          <strong>{{ allKnowledge.length }}</strong> 个知识点<span> / </span
          ><strong>{{ cards.length }}</strong> 张个人经验<span> / </span>{{ confirmedCount }} 张可用于问答
        </p>
      </div>
      <form class="learning-controls knowledge-search" @submit.prevent="search">
        <label
          >搜索知识与经验<input
            v-model="query"
            type="search"
            placeholder="知识名、别名或关键词，用空格组合" /></label
        ><button class="button" :disabled="searchLoading || !query.trim()">
          {{ searchLoading ? '正在检索…' : '检索资料' }}</button
        ><label
          >算法领域<select v-model="category">
            <option value="all">全部领域</option>
            <option v-for="c in categoryNames" :key="c">{{ c }}</option>
          </select></label
        >
        <button type="button" class="small-button" @click="clearFilters">清空筛选</button>
      </form>
      <p class="small subtle filter-summary" aria-live="polite">
        当前显示 {{ library.length }} 个知识点 ·
        {{ filteredCards.length }} 张经验卡。输入即筛选；“检索资料”还会查找原始复盘与有效经验。
      </p>
    </div>
    <p v-if="searchLoading" role="status" class="small subtle">正在检索内置知识、个人复盘与已确认经验…</p>
    <p v-if="searchError" role="alert" class="alert error">
      {{ searchError }} <button class="small-button" @click="search">重试检索</button>
    </p>
    <section v-if="searchedQuery" aria-label="检索结果" class="panel knowledge-results">
      <div class="section-head">
        <h2>“{{ searchedQuery }}”的资料</h2>
        <span class="small subtle">{{ results.length }} 条相关来源 · 全部领域</span>
      </div>
      <p v-if="!results.length" class="quiet-empty">没有找到相关资料，试试知识别名或减少关键词。</p>
      <div v-for="r in results" :key="r.id" class="knowledge-result">
        <RouterLink :to="r.url">{{ r.title }}</RouterLink>
        <p class="small subtle">
          来源：{{
            r.url.startsWith('/knowledge?card=')
              ? '内置知识'
              : r.url.includes('experience=')
                ? '个人经验'
                : '原始复盘'
          }}
        </p>
        <p class="result-excerpt">{{ r.excerpt }}</p>
      </div>
    </section>
    <KnowledgeReader
      :cards="library"
      :all="allKnowledge"
      :experiences="cards"
      :owner="owner()"
      :active="section === 'library'"
      @experience="navigateExperience"
      @ask="askAbout"
      @graph="
        (id) => {
          section = 'graph';
          focus = 'knowledge:' + id;
        }
      "
    />
    <section class="knowledge-experiences learning-stack" aria-label="个人经验卡">
      <div class="experience-heading">
        <div>
          <span class="eyebrow">FROM YOUR PRACTICE</span>
          <h2>个人经验卡</h2>
          <p class="small subtle">保留自己的判断、反例与教训。核对来源后再用于问答。</p>
        </div>
        <label
          >经验状态<select v-model="cardStatus">
            <option value="all">全部</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已确认且来源有效</option>
            <option value="stale">来源已失效</option>
          </select></label
        >
      </div>
      <p v-if="draftError" role="alert" class="alert">{{ draftError }}</p>
      <section v-if="pendingDrafts.length" class="panel pending-edits" aria-label="待保存编辑">
        <h3>
          继续未完成的编辑 <span class="small subtle">{{ pendingDrafts.length }} 张</span>
        </h3>
        <p class="small subtle">本浏览器按账号暂存；尚未写入经验库，也不会用于问答。换设备前请保存经验卡。</p>
        <div class="button-row">
          <button
            v-for="card in pendingDrafts"
            :key="card.id"
            class="small-button"
            @click="navigateExperience(card.id)"
          >
            继续编辑：{{ drafts.get(card.id)?.card.title || card.title }}
          </button>
        </div>
      </section>
      <p v-if="cards.length && !filteredCards.length" class="quiet-empty">
        当前筛选没有经验卡，试试其他关键词、领域或状态。
      </p>
      <p v-if="!cards.length" class="subtle">
        从题目详情的“解题助手 → 经验沉淀”生成草稿，确认后才会用于算法问答和知识图谱。
      </p>
      <article v-for="c in filteredCards" :key="c.id" class="panel learning-card">
        <div class="section-head">
          <h3>{{ c.title }}</h3>
          <span class="tag">{{ !c.sourceValid ? '来源已失效' : c.confirmed ? '已确认' : '草稿' }}</span>
        </div>
        <p v-if="!c.sourceValid" class="alert">
          来源已修改或删除，此卡当前不参与检索；请核对后重新保存确认。
        </p>
        <Markdown :text="c.content" />
        <div class="experience-tags">
          <RouterLink
            v-for="k in linkedKnowledge(c)"
            :key="k.id"
            :to="{ path: '/knowledge', query: { view: 'library', card: k.id } }"
            >{{ k.title }}</RouterLink
          ><span v-if="!c.knowledgeIds.length" class="small subtle">尚未关联知识点</span>
        </div>
        <div class="button-row">
          <RouterLink :to="'/problems/' + encodeURIComponent(c.problemKey)">原始复盘</RouterLink
          ><button class="small-button" @click="navigateExperience(c.id)">编辑与确认</button
          ><button
            class="small-button"
            :disabled="busy || c.edited || drafts.has(c.id)"
            :title="
              c.edited || drafts.has(c.id)
                ? '已有手工编辑，请使用编辑与确认，避免覆盖内容。'
                : '根据原始复盘重新生成草稿'
            "
            @click="updateCard('draft', c)"
          >
            刷新草稿</button
          ><button class="small-button" :disabled="busy" @click="updateCard('delete', c)">删除经验卡</button>
        </div>
      </article>
      <form
        v-if="selected"
        id="experience-editor"
        class="panel learning-card learning-stack"
        @submit.prevent="saveCard"
      >
        <h2>编辑经验卡</h2>
        <p class="small subtle" role="status">
          {{
            hasLocalEdit
              ? draftError
                ? '编辑尚未成功暂存，请先保存经验卡。'
                : '编辑已暂存在本浏览器，刷新后可继续。'
              : '修改会按账号暂存在本浏览器；保存后才会更新经验库。'
          }}
        </p>
        <p v-if="savedSelection && !savedSelection.sourceValid" class="alert">
          来源已修改或删除，原确认已取消。请查看原始复盘、核对内容后重新勾选确认；来源已删除时无法保存。
        </p>
        <RouterLink :to="'/problems/' + encodeURIComponent(selected.problemKey)"
          >查看原始复盘并核对来源 →</RouterLink
        >
        <div v-if="editConflict" class="alert draft-conflict" role="alert">
          <p>这张卡的已保存版本发生变化。你的本地编辑已保留，请对照后再保存。</p>
          <details>
            <summary>查看当前已保存版本</summary>
            <h3>{{ savedSelection?.title }}</h3>
            <Markdown :text="savedSelection?.content ?? ''" />
          </details>
          <label><input v-model="conflictReviewed" type="checkbox" />我已对照当前版本，保存本地编辑</label>
          <button type="button" class="small-button" @click="useSavedVersion">使用当前已保存版本</button>
        </div>
        <label>标题<input v-model="selected.title" required maxlength="300" /></label
        ><label>经验内容<textarea v-model="selected.content" rows="8" maxlength="50000" /></label>
        <div class="learning-checks">
          <label v-for="k in state?.knowledge" :key="k.id"
            ><input type="checkbox" :value="k.id" v-model="selected.knowledgeIds" />{{ k.title }}</label
          >
        </div>
        <label
          ><input type="checkbox" v-model="selected.confirmed" />我已核对内容及关联知识点，允许用于检索</label
        >
        <div class="button-row">
          <button class="button" :disabled="busy || (editConflict && !conflictReviewed)">保存经验卡</button>
          <button type="button" class="small-button" @click="closeEdit()">保留草稿并关闭</button>
          <button type="button" class="small-button" @click="closeEdit(true)">取消编辑</button>
        </div>
        <p class="small subtle">“取消编辑”会丢弃此卡的本地修改，已保存的经验卡不受影响。</p>
      </form>
    </section>
  </section>
  <section v-show="section === 'ask'" class="learning-stack">
    <form class="panel learning-card learning-stack" @submit.prevent="run('ask', { question })">
      <label
        >向算法助手提问<textarea
          v-model="question"
          id="knowledge-question"
          rows="3"
          required
          maxlength="2000"
          placeholder="结合我的复盘，二分答案经常出错的原因是什么？"
        />
      </label>
      <p class="small subtle">回答会区分资料依据与通用解释，可通过引用回到原始知识或复盘核对。</p>
      <button class="button" :disabled="busy || !state?.configured || !question.trim()">
        {{ busy ? '正在检索与回答…' : '检索并回答' }}
      </button>
    </form>
    <p v-if="!records.some((r) => r.kind === 'answer')" class="quiet-empty">
      还没有问答记录。可从知识卡发起提问，结合自己的复盘查找原因。
    </p>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'answer')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'answer'"
        ><h2>{{ r.question }}</h2>
        <div class="knowledge-answer-layout">
          <div>
            <h3>资料依据</h3>
            <Markdown :text="r.answer" />
            <h3>通用解释</h3>
            <Markdown :text="r.general" />
          </div>
          <aside aria-label="回答引用来源">
            <h3>引用来源</h3>
            <details v-for="c in r.citations" :key="c.id">
              <summary>{{ c.title }} {{ 'valid' in c && !c.valid ? '· 来源已失效' : '' }}</summary>
              <p>{{ c.excerpt }}</p>
              <RouterLink :to="c.url">查看来源</RouterLink>
            </details>
          </aside>
        </div></template
      >
    </article>
  </section>
  <KnowledgeGraph v-if="section === 'graph' && graph" :graph="graph" :initial-focus="focus" />
</template>

<style scoped>
.knowledge-ai-note {
  display: block;
  line-height: 1.8;
}
.knowledge-discovery,
.knowledge-results {
  padding: 24px;
}
.knowledge-overview,
.experience-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  margin-bottom: 20px;
}
.knowledge-overview h2,
.experience-heading h2 {
  margin: 6px 0 0;
  font-size: 20px;
}
.knowledge-overview p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.knowledge-overview strong {
  color: var(--ink);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.knowledge-overview p span {
  color: var(--line);
  margin: 0 8px;
}
.knowledge-search > label:first-child {
  flex: 3;
}
.knowledge-search > label {
  min-width: min(180px, 100%);
  margin: 0;
}
.knowledge-search > button,
.knowledge-experiences .button-row button {
  font-size: 12px;
}
.filter-summary {
  margin: 14px 0 0;
  line-height: 1.7;
}
.knowledge-results h2 {
  font-size: 17px;
  margin: 0;
}
.knowledge-result {
  padding: 16px 0;
  border-top: 1px solid var(--line);
}
.knowledge-result:last-child {
  padding-bottom: 0;
}
.knowledge-result > a {
  font-weight: 600;
}
.result-excerpt {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 7.2em;
  overflow: auto;
}
.knowledge-experiences {
  padding-top: 16px;
}
.pending-edits {
  padding: 20px;
}
.pending-edits h3 {
  margin: 0;
  font-size: 15px;
}
.pending-edits .button-row {
  flex-wrap: wrap;
}
.pending-edits button {
  overflow-wrap: anywhere;
  text-align: left;
}
.draft-conflict {
  display: grid;
  gap: 12px;
}
.draft-conflict p {
  margin: 0;
}
.draft-conflict label {
  margin: 0;
}
.draft-conflict details {
  min-width: 0;
  overflow-wrap: anywhere;
}
.experience-heading {
  margin-bottom: 0;
}
.experience-heading p {
  margin-bottom: 0;
}
.experience-heading label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  min-width: 180px;
}
.experience-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.experience-tags a {
  font-size: 12px;
  padding: 4px 8px;
  background: var(--accent-soft);
  border-radius: 4px;
  text-decoration: none;
}
.knowledge-answer-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr);
  gap: 24px;
}
.knowledge-answer-layout aside {
  border-left: 1px solid var(--line);
  padding-left: 20px;
  overflow-wrap: anywhere;
}
@media (max-width: 768px) {
  .knowledge-discovery,
  .knowledge-results {
    padding: 18px;
  }
  .knowledge-overview,
  .experience-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .knowledge-overview p {
    margin: 0;
  }
  .knowledge-search {
    gap: 12px;
  }
  .knowledge-search > label:first-child {
    flex-basis: 100%;
  }
  .knowledge-search > label {
    min-width: 100%;
  }
  .knowledge-answer-layout {
    grid-template-columns: 1fr;
  }
  .knowledge-answer-layout aside {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 16px 0 0;
  }
}
</style>
