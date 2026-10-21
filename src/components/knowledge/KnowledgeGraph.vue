<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { LearningService } from '../../../shared/learning-service';
import { categoryNames } from '../../../shared/training';
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
  (v) => (focus.value = v ?? ''),
);
const neighbors = computed(
  () =>
    new Set([
      focus.value,
      ...props.graph.edges.flatMap((e) =>
        e.from === focus.value ? [e.to] : e.to === focus.value ? [e.from] : [],
      ),
    ]),
);
const nodes = computed(() =>
  props.graph.nodes
    .filter(
      (n) =>
        (!focus.value || neighbors.value.has(n.id)) &&
        (category.value === 'all' || n.category === category.value) &&
        (kind.value === 'all' || n.kind === kind.value) &&
        (!query.value || (n.label + ' ' + n.id).toLowerCase().includes(query.value.toLowerCase())),
    )
    .sort((a, b) => Number(b.id === focus.value) - Number(a.id === focus.value)),
);
const drawing = computed(() =>
  nodes.value.slice(0, 40).map((n, i, all) => ({
    ...n,
    x: 420 + 310 * Math.cos((i * 2 * Math.PI) / all.length),
    y: 240 + 185 * Math.sin((i * 2 * Math.PI) / all.length),
  })),
);
const edges = computed(() =>
  props.graph.edges.flatMap((e) => {
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
  <section class="learning-stack">
    <div class="learning-controls">
      <label>检索图谱节点<input v-model="query" placeholder="名称或题号" /></label
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
      ><button
        class="small-button"
        @click="
          focus = '';
          query = '';
          category = 'all';
          kind = 'all';
        "
      >
        显示全部关系
      </button>
    </div>
    <p>
      共 {{ graph.nodes.length }} 个节点 · 当前匹配 {{ nodes.length }} 个 · 画布显示
      {{ drawing.length }} 个。下方列表包含全部匹配结果。
    </p>
    <p v-if="focus" class="alert">
      当前邻域：{{
        graph.nodes.find((n) => n.id === focus)?.label ?? '节点已失效，请重置'
      }}。点击列表中的“展开”切换中心。
    </p>
    <div class="panel learning-graph">
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
      <p v-if="!nodes.length" class="quiet-empty">没有匹配节点，请调整检索条件。</p>
      <details
        v-for="(e, i) in graph.edges.filter((e) => !focus || e.from === focus || e.to === focus)"
        :key="i"
      >
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
