<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, notify } from '../api';
import { useLearningState } from '../learningState';
import { useSection } from '../sections';
import Markdown from '../components/Markdown.vue';
import KnowledgeReader from '../components/knowledge/KnowledgeReader.vue';
import KnowledgeGraph from '../components/knowledge/KnowledgeGraph.vue';
import { categoryNames } from '../../shared/training';
import type { LearningService } from '../../shared/learning-service';
import type { ExperienceCard, Citation } from '../../shared/learning-domain';
const route = useRoute();
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
const filteredCards = computed(() =>
  cards.value.filter(
    (c) =>
      cardStatus.value === 'all' ||
      (cardStatus.value === 'stale' && !c.sourceValid) ||
      (cardStatus.value === 'confirmed' && c.confirmed && c.sourceValid) ||
      (cardStatus.value === 'draft' && !c.confirmed),
  ),
);
const records = computed(() => state.value?.records ?? []);
const cards = computed(() =>
  records.value.filter((r): r is ExperienceCard & { sourceValid: boolean } => r.kind === 'card'),
);
const library = computed(() =>
  (state.value?.knowledge ?? []).filter(
    (k) =>
      (category.value === 'all' || k.category === category.value) &&
      (k.title + k.content + k.aliases.join(' ')).toLowerCase().includes(query.value.toLowerCase()),
  ),
);
let graphSerial = 0,
  searchSerial = 0,
  alive = true;
const graphLoading = ref(false);
onBeforeUnmount(() => {
  alive = false;
  graphSerial++;
  searchSerial++;
});
async function load() {
  await session.load();
  if (route.query.experience && !selected.value) {
    const card = cards.value.find((c) => c.id === route.query.experience);
    if (card) {
      selected.value = JSON.parse(JSON.stringify(card));
      await nextTick();
      document.getElementById('experience-editor')?.scrollIntoView({ block: 'center' });
    }
  }
}
async function loadGraph() {
  const serial = ++graphSerial;
  graphLoading.value = true;
  error.value = '';
  try {
    const next = await api<ReturnType<LearningService['graph']>>('/learning/graph');
    if (serial === graphSerial) graph.value = next;
  } catch (e) {
    if (serial === graphSerial) error.value = (e as Error).message;
  } finally {
    if (serial === graphSerial) graphLoading.value = false;
  }
}
async function search() {
  const serial = ++searchSerial;
  try {
    const next = await api<Citation[]>('/learning/search', { query: query.value });
    if (alive && serial === searchSerial) results.value = next;
  } catch (e) {
    if (alive && serial === searchSerial) error.value = (e as Error).message;
  }
}
async function saveCard() {
  if (selected.value && (await run('card', selected.value))) {
    selected.value = undefined;
    notify('经验卡已保存');
  }
}
onMounted(() => {
  void load();
});
watch(
  () => route.query.card,
  () => {
    category.value = 'all';
    query.value = '';
    section.value = 'library';
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
  () => {
    void load();
  },
);
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">LEARN / CONNECT / VERIFY</div>
      <h1>知识中心</h1>
      <RouterLink class="astra-context-link" to="/companion">与星澪讨论知识</RouterLink>
      <p class="subtle">把每次复盘变成下次能用上的经验。</p>
    </div>
  </div>
  <div v-if="error" role="alert" class="alert error">
    {{ error }} <button @click="section === 'graph' ? loadGraph() : load()">重试</button>
  </div>
  <p v-if="session.loading.value" role="status">正在读取知识与经验…</p>
  <p v-if="graphLoading" role="status">正在读取知识图谱…</p>
  <div v-if="message" role="status" class="alert">{{ message }}</div>
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
  <p v-if="state && !state.configured" class="alert">
    未配置 AI。仍可浏览知识卡、搜索个人资料和查看历史；生成内容请先到<RouterLink to="/settings?view=ai"
      >设置与数据</RouterLink
    >配置接口。
  </p>
  <section v-show="section === 'library'" class="learning-stack">
    <div class="learning-controls">
      <label
        >搜索知识与经验<input
          v-model="query"
          @keyup.enter="search"
          placeholder="例如：二分边界、动态规划" /></label
      ><button class="button" @click="search">检索资料</button
      ><label
        >算法领域<select v-model="category">
          <option value="all">全部领域</option>
          <option v-for="c in categoryNames" :key="c">{{ c }}</option>
        </select></label
      >
    </div>
    <div v-for="r in results" :key="r.id" class="panel learning-card">
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
      <p>{{ r.excerpt }}</p>
    </div>
    <KnowledgeReader
      :cards="library"
      :all="state?.knowledge ?? []"
      @graph="
        (id) => {
          section = 'graph';
          focus = 'knowledge:' + id;
        }
      "
    />
    <h2>个人经验卡</h2>
    <label
      >经验状态<select v-model="cardStatus">
        <option value="all">全部</option>
        <option value="draft">草稿</option>
        <option value="confirmed">已确认且来源有效</option>
        <option value="stale">来源已失效</option>
      </select></label
    >
    <p v-if="cards.length && !filteredCards.length" class="quiet-empty">当前状态没有经验卡。</p>
    <p v-if="!cards.length" class="subtle">
      从题目详情的“解题助手 → 经验沉淀”生成草稿，确认后才会用于算法问答和知识图谱。
    </p>
    <article v-for="c in filteredCards" :key="c.id" class="panel learning-card">
      <div class="section-head">
        <h3>{{ c.title }}</h3>
        <span class="tag">{{ c.confirmed ? '已确认' : '草稿' }}</span>
      </div>
      <p v-if="!c.sourceValid" class="alert">来源已修改或删除，此卡当前不参与检索；请核对后重新保存确认。</p>
      <Markdown :text="c.content" />
      <div class="button-row">
        <RouterLink :to="'/problems/' + encodeURIComponent(c.problemKey)">原始复盘</RouterLink
        ><button class="small-button" @click="selected = JSON.parse(JSON.stringify(c))">编辑与确认</button
        ><button
          class="small-button"
          :disabled="busy"
          @click="run('draft', { problemKey: c.problemKey, sourceId: c.sourceId })"
        >
          刷新草稿</button
        ><button class="small-button" :disabled="busy" @click="run('delete', { id: c.id })">
          删除经验卡
        </button>
      </div>
    </article>
    <form
      v-if="selected"
      id="experience-editor"
      class="panel learning-card learning-stack"
      @submit.prevent="saveCard"
    >
      <h2>编辑经验卡</h2>
      <label>标题<input v-model="selected.title" required /></label
      ><label>经验内容<textarea v-model="selected.content" rows="8" /></label>
      <div class="learning-checks">
        <label v-for="k in state?.knowledge" :key="k.id"
          ><input type="checkbox" :value="k.id" v-model="selected.knowledgeIds" />{{ k.title }}</label
        >
      </div>
      <label
        ><input type="checkbox" v-model="selected.confirmed" />我已核对内容及关联知识点，允许用于检索</label
      >
      <div class="button-row">
        <button class="button" :disabled="busy">保存经验卡</button
        ><button type="button" class="small-button" @click="selected = undefined">取消编辑</button>
      </div>
    </form>
  </section>
  <section v-show="section === 'ask'" class="learning-stack">
    <form class="panel learning-card learning-stack" @submit.prevent="run('ask', { question })">
      <label
        >向算法助手提问<textarea
          v-model="question"
          rows="3"
          required
          maxlength="2000"
          placeholder="结合我的复盘，二分答案经常出错的原因是什么？"
        /></label
      ><button class="button" :disabled="busy">{{ busy ? '正在检索与回答…' : '检索并回答' }}</button>
    </form>
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
