<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PlanningState } from '../../../shared/planning-domain';
import { knowledgeCards } from '../../../shared/knowledge';
const props = defineProps<{
  path: PlanningState['path'];
  tracing: PlanningState['tracing'];
  evidence: PlanningState['evidence'];
}>();
const expanded = ref(false);
const nodes = computed(() =>
  expanded.value ? props.path.nodes : props.path.nodes.filter((n) => !n.verified).slice(0, 5),
);
const state = (id: string) => props.tracing.states.find((s) => s.skillId === id);
</script>
<template>
  <section class="panel path-panel" aria-labelledby="learning-path-title">
    <div class="section-head">
      <div>
        <span class="eyebrow">A PATH YOU CAN EXPLAIN</span>
        <h2 id="learning-path-title">从基础走向目标</h2>
      </div>
      <span class="badge">{{ path.nodes.length }} 个节点</span>
    </div>
    <p class="subtle">先修关系是学习建议，每一步都可直接打开。浏览知识卡不会计为掌握。</p>
    <p v-if="!path.targets.length" class="quiet-empty">选择想学的知识点，查看需要补足的基础与下一步。</p>
    <div v-if="path.issues.length" role="alert" class="alert error">
      先修关系暂不可用：{{ path.issues.map((i) => i.ids.join(' → ')).join('；') }}。仍可进入知识中心学习。
    </div>
    <ol class="path-steps">
      <li v-for="(node, index) in nodes" :key="node.id" :class="{ 'path-next': node.id === path.next }">
        <span class="path-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <div class="path-content">
          <div class="path-heading">
            <RouterLink :to="'/knowledge?card=' + node.id">{{ node.title }}</RouterLink
            ><span class="badge">{{
              node.verified
                ? '已有独立验证'
                : node.id === path.next
                  ? '建议下一步'
                  : node.target
                    ? '目标'
                    : '基础'
            }}</span>
          </div>
          <p>{{ node.reason }}</p>
          <p class="small subtle">
            {{ state(node.id)?.distinctProblems ?? 0 }} 道题 · {{ state(node.id)?.samples ?? 0 }} 次可信观察 ·
            {{
              state(node.id)?.insufficient !== false
                ? '样本不足'
                : `BKT 估计 ${Math.round((state(node.id)?.probability ?? 0) * 100)}%`
            }}
          </p>
          <details>
            <summary>学习要求与证据</summary>
            <p v-if="!node.verified" class="small subtle">
              验证练习参考负担约 {{ node.estimatedMinutes }} 分钟，按每道 35 分钟估计；实际用时因人而异。
            </p>
            <p class="small subtle">
              完成条件：至少三道不同题目的可核验独立完成。后继：{{
                node.successors
                  .map((id) => knowledgeCards.find((k) => k.id === id)?.title ?? id)
                  .join('、') || '目标终点'
              }}
            </p>
            <p v-if="node.prerequisites.length" class="subtle">
              建议先学：{{
                node.prerequisites
                  .map((id) => knowledgeCards.find((k) => k.id === id)?.title ?? id)
                  .join('、')
              }}
            </p>

            <p>至少三道不同题目的独立验证可提示跳过；不替代原有五阶段掌握状态。</p>
            <ul>
              <li v-for="id in state(node.id)?.evidenceIds" :key="id">
                <RouterLink
                  v-if="evidence.find((e) => e.id === id)"
                  :to="{
                    path: '/problems/' + encodeURIComponent(evidence.find((e) => e.id === id)!.problemKey),
                    query: { view: 'evidence' },
                  }"
                  >{{ evidence.find((e) => e.id === id)?.problemKey }} ·
                  {{ evidence.find((e) => e.id === id)?.at.slice(0, 10) }} · 查看原始证据</RouterLink
                ><span v-else>观察编号 {{ id }} · 当前来源不可用</span>
              </li>
            </ul>
          </details>
          <RouterLink
            :to="{ path: '/battle', query: { skill: node.id } }" class="text-link"
            >开始连战 →</RouterLink>
          <RouterLink
            :to="
              '/problems?tag=' +
              encodeURIComponent(knowledgeCards.find((k) => k.id === node.id)?.tags[0] ?? '')
            "
            class="text-link"
            >查找相关练习 →</RouterLink
          >
        </div>
      </li>
    </ol>
    <button
      v-if="path.nodes.length > 5 || path.nodes.some((n) => n.verified)"
      class="small-button"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起完整路径' : `展开全部 ${path.nodes.length} 个节点` }}
    </button>
    <details class="path-method">
      <summary>推荐依据与算法版本</summary>
      <p>
        先修依赖排序 {{ path.version }} · {{ tracing.version }}。BKT
        参数尚未校准，少于三道题的观察采用保守排序，不预测遗忘。提示后的成功与无法归因的混合技能证据不作为独立正确观察。
      </p>
    </details>
  </section>
</template>
<style scoped>
.path-panel {
  padding: 16px;
}
.path-steps {
  padding: 0;
  list-style: none;
  margin: 12px 0;
}
.path-steps > li {
  display: flex;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.path-number {
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  padding-top: 4px;
}
.path-content {
  min-width: 0;
  flex: 1;
}
.path-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.path-heading > a {
  font-size: 17px;
  font-weight: 650;
}
.path-content p {
  font-size: 13px;
  line-height: 1.7;
  margin: 5px 0;
}
.path-next .path-number {
  color: var(--highlight);
  font-weight: 700;
}
.path-method {
  margin-top: 20px;
  font-size: 12px;
  color: var(--muted);
}
.path-method p {
  line-height: 1.8;
}
.path-content li {
  overflow-wrap: anywhere;
}
@media (max-width: 500px) {
  .path-panel {
    padding: 14px;
  }
  .path-heading {
    flex-wrap: wrap;
  }
  .path-steps > li {
    gap: 10px;
  }
}
</style>
