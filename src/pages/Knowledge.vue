<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, notify } from '../api';
import { checkLearningAgent } from '../learning';
import Markdown from '../components/Markdown.vue';
import { categoryNames } from '../../shared/training';
import type { LearningService } from '../../shared/learning-service';
import type { ExperienceCard, LearningRecord, Citation } from '../../shared/learning-domain';
import { usePageReady } from '../pageScene';
const ready = usePageReady(),
  route = useRoute();
const transferLabels = { pending: '待验证', independent: '独立完成', hint: '借助提示', failed: '未完成' };
const nodeLabels: Record<string, string> = {
  knowledge: '知识点',
  problem: '题目',
  reason: '错因',
  experience: '经验卡',
};
const state = ref<ReturnType<LearningService['state']>>(),
  graph = ref<ReturnType<LearningService['graph']>>();
const section = ref(String(route.query.view || 'library')),
  query = ref(''),
  results = ref<Citation[]>([]),
  question = ref(''),
  period = ref<'30' | 'all'>('30');
const busy = ref(false),
  error = ref(''),
  message = ref(''),
  selected = ref<ExperienceCard>(),
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
const auto = computed(() => records.value.some((r) => r.kind === 'preferences' && r.auto));
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
async function load() {
  try {
    [state.value, graph.value] = await Promise.all([
      api<ReturnType<LearningService['state']>>('/learning/state'),
      api<ReturnType<LearningService['graph']>>('/learning/graph'),
    ]);
    if (route.query.experience) {
      const c = cards.value.find((c) => c.id === route.query.experience);
      if (c) selected.value = JSON.parse(JSON.stringify(c));
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    ready();
  }
}
async function run(action: string, input: unknown) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await api<LearningRecord & { message?: string }>('/learning/' + action, input);
    message.value = result.message || '已完成';
    await load();
    return result;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function search() {
  try {
    results.value = await api('/learning/search', { query: query.value });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveCard() {
  if (selected.value && (await run('card', selected.value))) {
    selected.value = undefined;
    notify('经验卡已保存');
  }
}
async function evaluate(id: string, result: 'independent' | 'hint' | 'failed') {
  await run('transfer-result', { id, result, minutes: Number(transferMinutes.value[id] || 0) });
  void checkLearningAgent();
}
const transferMinutes = ref<Record<string, number>>({});
onMounted(load);
watch(
  () => route.query,
  () => {
    section.value = String(route.query.view || 'library');
    void load();
  },
);
</script>
<template>
  <div class="page-head">
    <div>
      <div class="eyebrow">LEARN / CONNECT / VERIFY</div>
      <h1>知识中心</h1>
      <p class="subtle">把每次复盘变成下次能用上的经验。</p>
    </div>
  </div>
  <div v-if="error" role="alert" class="alert error">{{ error }}</div>
  <div v-if="message" role="status" class="alert">{{ message }}</div>
  <nav class="content-switcher learning-tabs" aria-label="知识中心内容">
    <button
      v-for="s in [
        { id: 'library', label: '知识与经验' },
        { id: 'ask', label: 'RAG 问答' },
        { id: 'graph', label: '知识图谱' },
        { id: 'diagnosis', label: '学情诊断' },
        { id: 'training', label: '训练 Agent' },
        { id: 'transfers', label: '迁移检测' },
      ]"
      :key="s.id"
      :class="{ active: section === s.id }"
      @click="section = s.id"
    >
      {{ s.label }}
    </button>
  </nav>
  <p v-if="state && !state.configured" class="alert">
    未配置 AI。仍可浏览知识卡、搜索个人资料和查看历史；生成内容请先到<RouterLink to="/settings"
      >设置与数据</RouterLink
    >配置接口。
  </p>
  <section v-if="section === 'library'" class="learning-stack">
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
    <p v-if="!cards.length" class="subtle">从题目详情的“学习闭环”生成草稿，确认后才会用于 RAG 和知识图谱。</p>
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
  <section v-if="section === 'ask'" class="learning-stack">
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
  <section v-if="section === 'diagnosis'" class="learning-stack">
    <div class="learning-controls">
      <label
        >诊断范围<select v-model="period">
          <option value="30">最近 30 天</option>
          <option value="all">全部历史</option>
        </select></label
      ><button class="button" :disabled="busy" @click="run('diagnose', { period })">生成学情诊断</button>
    </div>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'diagnosis')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'diagnosis'"
        ><h2>
          {{ r.period === '30' ? '近 30 天' : '全部历史' }} ·
          {{ new Date(r.createdAt).toLocaleString('zh-CN') }}
        </h2>
        <p v-for="w in r.warnings" :key="w" class="subtle">{{ w }}</p>
        <div v-for="(f, i) in r.findings" :key="i">
          <Markdown :text="f.cause" /><Markdown :text="f.action" />
          <details>
            <summary>查看诊断证据</summary>
            <div v-for="id in f.evidenceIds" :key="id">
              <p>{{ r.evidence.find((e) => e.id === id)?.text ?? id }}</p>
              <RouterLink
                v-if="id.startsWith('problem:')"
                :to="'/problems/' + encodeURIComponent(id.slice(8))"
                >查看原始复盘</RouterLink
              >
            </div>
          </details>
          <RouterLink v-for="k in f.knowledgeIds" :key="k" :to="'/knowledge?card=' + k"
            >{{ state?.knowledge.find((n) => n.id === k)?.title }}
          </RouterLink>
        </div></template
      >
    </article>
  </section>
  <section v-if="section === 'training'" class="learning-stack">
    <div class="panel learning-card learning-stack">
      <h2>次日训练计划</h2>
      <p>AI 依据训练反馈与比赛建议调整未来题单。当天题单保持稳定，每栏最多五题，失败时沿用规则推荐。</p>
      <label
        ><input
          type="checkbox"
          :checked="auto"
          :disabled="busy"
          @change="run('preferences', { auto: !auto })"
        />自动调整次日计划（仅在应用运行时触发）</label
      ><button class="button" :disabled="busy" @click="run('agent', { automatic: false })">
        生成次日计划</button
      ><RouterLink to="/">查看今日题单与周目标</RouterLink>
    </div>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'revision' || r.kind === 'agent-run')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'revision'"
        ><h3>{{ r.date }} · {{ r.reverted ? '已撤回' : '计划修订' }}</h3>
        <Markdown :text="r.reason" />
        <p>调整前：{{ r.before.newKeys.join('、') }}</p>
        <p>调整后：{{ r.after.newKeys.join('、') }}</p>
        <details>
          <summary>输入摘要</summary>
          <pre>{{ r.inputSummary }}</pre>
        </details>
        <button class="small-button" :disabled="busy || r.reverted" @click="run('revert', { id: r.id })">
          撤回此版本
        </button></template
      >
      <p v-else-if="r.kind === 'agent-run'">
        {{ new Date(r.createdAt).toLocaleString('zh-CN') }} · {{ r.message }}
      </p>
    </article>
  </section>
  <section v-if="section === 'transfers'" class="learning-stack">
    <p class="subtle">
      从题目详情推荐相关变式题，占用次日新知名额。标签相关不代表严格等价，独立完成须有同步 AC 证据。
    </p>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'transfer')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'transfer'"
        ><h2>{{ r.targetKey }} · {{ r.date }}</h2>
        <p>{{ r.reason }}</p>
        <div class="button-row">
          <RouterLink :to="'/problems/' + encodeURIComponent(r.problemKey)">原始复盘</RouterLink
          ><a
            :href="'https://codeforces.com/problemset/problem/' + r.targetKey.replace(':', '/')"
            target="_blank"
            rel="noreferrer"
            >打开迁移题</a
          >
        </div>
        <p>结果：{{ transferLabels[r.result] }}</p>
        <div v-if="r.result === 'pending'" class="learning-controls">
          <label
            >迁移练习用时（分钟）<input
              v-model="transferMinutes[r.id]"
              type="number"
              min="0"
              max="100000" /></label
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'independent')">
            独立完成</button
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'hint')">借助提示</button
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'failed')">未完成</button>
        </div></template
      >
    </article>
  </section>
</template>
