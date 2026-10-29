<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LearningService } from '../../../shared/learning-service';
import { categoryNames } from '../../../shared/training';
import { filterKnowledgeGraph } from '../../../shared/knowledge-graph';
const props = defineProps<{ graph: ReturnType<LearningService['graph']>; initialFocus?: string }>();
const focus = ref(props.initialFocus ?? ''),
  query = ref(''),
  category = ref('all'),
  kind = ref('all');
const labels: Record<string, string> = {
  knowledge: '知识点',
  problem: '题目',
  reason: '错因',
  experience: '经验卡',
};
watch(
  () => props.initialFocus,
  (v) => select(v ?? ''),
);
const filtered = computed(() =>
  filterKnowledgeGraph(props.graph, {
    focus: focus.value,
    query: query.value,
    category: category.value,
    kind: kind.value,
  }),
);
const nodes = computed(() => filtered.value.nodes);
const drawing = computed(() =>
  nodes.value.slice(0, 40).map((n, i, all) => ({
    ...n,
    x: 420 + 310 * Math.cos((i * 2 * Math.PI) / all.length),
    y: 240 + 185 * Math.sin((i * 2 * Math.PI) / all.length),
  })),
);
const edges = computed(() =>
  filtered.value.edges.flatMap((e) => {
    const a = drawing.value.find((n) => n.id === e.from),
      b = drawing.value.find((n) => n.id === e.to);
    return a && b ? [{ ...e, a, b }] : [];
  }),
);
function select(id: string) {
  focus.value = id;
  query.value = '';
  category.value = 'all';
  kind.value = 'all';
}
</script>
<template>
  <section class="learning-stack" aria-label="知识图谱">
    <div class="learning-controls">
      <label
        >检索图谱节点<input v-model="query" type="search" placeholder="名称、别名或题号，用空格组合" /></label
      ><label
        >节点类型<select v-model="kind">
          <option value="all">全部类型</option>
          <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
        </select></label
      ><label
        >图谱领域<select v-model="category">
          <option value="all">全部领域</option>
          <option v-for="c in categoryNames" :key="c">{{ c }}</option>
        </select></label
      ><button class="small-button" @click="select('')">显示全部关系</button>
    </div>
    <p class="small subtle" aria-live="polite">
      共 {{ graph.nodes.length }} 个节点 · 当前匹配 {{ nodes.length }} 个 · 画布显示 {{ drawing.length }} 个 ·
      {{ filtered.edges.length }} 条匹配关系。下方列表包含全部匹配结果。
    </p>
    <div v-if="focus" class="alert graph-scope" role="status">
      <span
        >搜索范围：{{ graph.nodes.find((n) => n.id === focus)?.label ?? '节点已失效' }}及其直接关联。</span
      >
      <button class="small-button" @click="focus = ''">退出邻域，保留筛选</button>
    </div>
    <p v-else class="small subtle">搜索范围：全部图谱。展开节点可查看直接关联，并重置筛选。</p>
    <div v-if="drawing.length" class="panel learning-graph">
      <svg viewBox="0 0 840 480" role="img" aria-label="算法知识关系图">
        <line
          v-for="(e, i) in edges"
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
          tabindex="0"
          role="button"
          :aria-label="n.label"
          @click="select(n.id)"
          @keydown.enter="select(n.id)"
          @keydown.space.prevent="select(n.id)"
        >
          <circle :cx="n.x" :cy="n.y" :r="n.id === focus ? 12 : 8" fill="var(--accent)" />
          <text :x="n.x" :y="n.y + 23" text-anchor="middle" font-size="12" fill="currentColor">
            {{ n.label.slice(0, 16) }}
          </text>
        </g>
      </svg>
    </div>
    <div class="panel learning-card learning-table">
      <table>
        <caption>
          完整节点列表（{{
            nodes.length
          }}）
        </caption>
        <thead>
          <tr>
            <th>节点</th>
            <th>类型</th>
            <th>样本</th>
            <th>独立完成记录</th>
            <th>提示会话</th>
            <th>关系</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="n in nodes" :key="n.id">
            <td>
              <RouterLink :to="n.url">{{ n.label }}</RouterLink>
            </td>
            <td>{{ labels[n.kind] }}</td>
            <td>{{ n.samples }}</td>
            <td>{{ n.independent }}</td>
            <td>{{ n.hints }}</td>
            <td><button class="small-button" @click="select(n.id)">展开</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="!nodes.length" class="quiet-empty">
        <p>当前范围内没有匹配节点，可减少关键词或重置筛选。</p>
        <button class="small-button" @click="select('')">重置并显示全部节点</button>
      </div>
      <h3>
        当前节点之间的关系 <span class="small subtle">{{ filtered.edges.length }} 条</span>
      </h3>
      <p v-if="nodes.length && !filtered.edges.length" class="small subtle">
        当前筛选的节点之间没有直接关系；展开节点可查看它的关联。
      </p>
      <details v-for="(e, i) in filtered.edges" :key="i">
        <summary>
          {{ graph.nodes.find((n) => n.id === e.from)?.label }} →
          {{ graph.nodes.find((n) => n.id === e.to)?.label }} · {{ e.relation }}
        </summary>
        <RouterLink v-if="e.source.startsWith('/')" :to="e.source">查看来源</RouterLink
        ><span v-else>来源：{{ e.source }}</span>
      </details>
    </div>
  </section>
</template>
<style scoped>
.graph-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.graph-scope .small-button {
  font-size: 12px;
}
</style>
