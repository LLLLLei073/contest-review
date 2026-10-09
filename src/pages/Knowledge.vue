<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, notify } from '../api';
import { useLearningState } from '../learningState';
import { useSection } from '../sections';
import Markdown from '../components/Markdown.vue';
import { categoryNames } from '../../shared/training';
import type { LearningService } from '../../shared/learning-service';
import type { ExperienceCard, Citation } from '../../shared/learning-domain';
const route = useRoute();
const nodeLabels: Record<string, string> = {
  knowledge: '知识点',
  problem: '题目',
  reason: '错因',
  experience: '经验卡',
};
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
const graphNodes = computed(() => {
  const all = graph.value?.nodes ?? [],
    edges = graph.value?.edges ?? [];
  return all.filter(
    (n) =>
      (category.value === 'all' || n.category === category.value) &&
      (!focus.value ||
        n.id === focus.value ||
        edges.some(
          (e) => (e.from === focus.value && e.to === n.id) || (e.to === focus.value && e.from === n.id),
        )),
  );
});
const drawing = computed(() =>
  graphNodes.value.slice(0, 40).map((n, i, all) => ({
    ...n,
    x: 420 + 310 * Math.cos((i * 2 * Math.PI) / all.length),
    y: 240 + 185 * Math.sin((i * 2 * Math.PI) / all.length),
  })),
);
const drawingEdges = computed(() =>
  (graph.value?.edges ?? []).flatMap((e) => {
    const a = drawing.value.find((n) => n.id === e.from),
      b = drawing.value.find((n) => n.id === e.to);
    return a && b ? [{ ...e, a, b }] : [];
  }),
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
    if (card) selected.value = JSON.parse(JSON.stringify(card));
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
      <p>{{ r.excerpt }}</p>
    </div>
    <div class="learning-grid">
      <article
        v-for="k in library"
        :key="k.id"
        :id="k.id"
        :class="['panel', 'learning-card', { 'learning-selected': route.query.card === k.id }]"
      >
        <span class="eyebrow">{{ k.category }}</span>
        <h2>{{ k.title }}</h2>
        <Markdown :text="k.content" />
        <p class="small subtle">
          别名：{{ k.aliases.join('、') }}<br />前置：{{
            k.prerequisites
              .map((id) => state?.knowledge.find((card) => card.id === id)?.title ?? id)
              .join('、') || '无'
          }}
        </p>
        <button
          class="small-button"
          @click="
            section = 'graph';
            focus = 'knowledge:' + k.id;
          "
        >
          查看关联
        </button>
      </article>
    </div>
    <h2>个人经验卡</h2>
    <p v-if="!cards.length" class="subtle">
      从题目详情的“解题助手 → 经验沉淀”生成草稿，确认后才会用于算法问答和知识图谱。
    </p>
    <article v-for="c in cards" :key="c.id" class="panel learning-card">
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
    <form v-if="selected" class="panel learning-card learning-stack" @submit.prevent="saveCard">
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
        <h3>资料依据</h3>
        <Markdown :text="r.answer" />
        <h3>通用解释</h3>
        <Markdown :text="r.general" />
        <details v-for="c in r.citations" :key="c.id">
          <summary>{{ c.title }} {{ 'valid' in c && !c.valid ? '· 来源已失效' : '' }}</summary>
          <p>{{ c.excerpt }}</p>
          <RouterLink :to="c.url">查看来源</RouterLink>
        </details></template
      >
    </article>
  </section>
  <section v-if="section === 'graph'" class="learning-stack">
    <div class="learning-controls">
      <label
        >图谱领域<select v-model="category">
          <option value="all">全部领域</option>
          <option v-for="c in categoryNames" :key="c">{{ c }}</option>
        </select></label
      ><button class="small-button" @click="focus = ''">显示全部关系</button>
    </div>
    <p class="subtle">点击节点展开相邻关系。图形最多展示 40 个节点，完整结果见下方列表；连线来源可查看。</p>
    <div class="panel learning-graph">
      <svg viewBox="0 0 840 480" role="img" aria-label="算法知识关系图">
        <line
          v-for="(e, i) in drawingEdges"
          :key="i"
          :x1="e.a.x"
          :y1="e.a.y"
          :x2="e.b.x"
          :y2="e.b.y"
          stroke="currentColor"
          opacity=".2"
        >
          <title>{{ e.relation }} · {{ e.source }}</title>
        </line>
        <g
          v-for="n in drawing"
          :key="n.id"
          @click="focus = n.id"
          @keydown.enter="focus = n.id"
          tabindex="0"
          role="button"
          :aria-label="n.label"
        >
          <circle :cx="n.x" :cy="n.y" r="9" :fill="n.kind === 'knowledge' ? '#92563a' : '#3e6858'" />
          <text :x="n.x" :y="n.y + 23" text-anchor="middle" font-size="12" fill="currentColor">
            {{ n.label.slice(0, 16) }}
          </text>
        </g>
      </svg>
    </div>
    <div class="panel learning-card learning-table">
      <table>
        <thead>
          <tr>
            <th>节点</th>
            <th>类型</th>
            <th>样本</th>
            <th>独立完成证据</th>
            <th>提示使用</th>
            <th>关系</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in graphNodes" :key="n.id">
            <td>
              <RouterLink :to="n.url">{{ n.label }}</RouterLink>
            </td>
            <td>{{ nodeLabels[n.kind] || n.kind }}</td>
            <td>{{ n.samples }}</td>
            <td>{{ n.independent }}</td>
            <td>{{ n.hints }}</td>
            <td><button class="small-button" @click="focus = n.id">展开</button></td>
          </tr>
        </tbody>
      </table>
      <details
        v-for="(e, i) in graph?.edges.filter((e) => !focus || e.from === focus || e.to === focus)"
        :key="i"
      >
        <summary>
          {{ graph?.nodes.find((n) => n.id === e.from)?.label }} →
          {{ graph?.nodes.find((n) => n.id === e.to)?.label }} · {{ e.relation }}
        </summary>
        来源：{{ e.source }}
      </details>
    </div>
  </section>
</template>
