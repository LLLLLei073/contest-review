<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { KnowledgeCard } from '../../../shared/knowledge';
import Markdown from '../Markdown.vue';
const props = defineProps<{ cards: KnowledgeCard[]; all: KnowledgeCard[] }>();
const emit = defineEmits<{ graph: [id: string] }>();
const route = useRoute();
const selected = computed(() => props.cards.find((c) => c.id === route.query.card) ?? props.cards[0]);
</script>
<template>
  <div v-if="cards.length" class="knowledge-reader">
    <nav class="panel" aria-label="知识目录">
      <p class="small subtle">{{ cards.length }} 个知识点 · 离线可读</p>
      <RouterLink
        v-for="card in cards"
        :key="card.id"
        :to="{ path: '/knowledge', query: { ...route.query, card: card.id } }"
        :aria-current="selected?.id === card.id ? 'page' : undefined"
        ><span>{{ card.title }}</span
        ><small>{{ card.category }}</small></RouterLink
      >
    </nav>
    <article v-if="selected" class="panel learning-card" :id="selected.id">
      <span class="eyebrow">{{ selected.category }}</span>
      <h2>{{ selected.title }}</h2>
      <Markdown :text="selected.content" />
      <p class="small subtle">别名：{{ selected.aliases.join('、') }}</p>
      <h3>先修知识</h3>
      <p v-if="!selected.prerequisites.length">可从这里开始学习。</p>
      <div class="button-row">
        <RouterLink
          v-for="id in selected.prerequisites"
          :key="id"
          :to="{ path: '/knowledge', query: { card: id } }"
          >{{ all.find((c) => c.id === id)?.title ?? id }}</RouterLink
        >
      </div>
      <div class="button-row">
        <button class="small-button" @click="emit('graph', selected.id)">查看关联</button
        ><RouterLink to="/?view=path" class="small-button">加入目标学习路径 →</RouterLink>
      </div>
    </article>
  </div>
  <p v-else class="quiet-empty">没有匹配的内置知识，试试别名或其他领域。</p>
</template>
<style scoped>
.knowledge-reader {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.knowledge-reader nav {
  padding: 16px;
  max-height: 640px;
  overflow: auto;
}
.knowledge-reader nav a {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 8px;
  color: var(--ink);
  text-decoration: none;
}
.knowledge-reader nav a[aria-current] {
  background: var(--wash);
  color: var(--accent);
}
.knowledge-reader nav small {
  color: var(--muted);
}
.button-row {
  margin-top: 16px;
}
@media (max-width: 700px) {
  .knowledge-reader {
    grid-template-columns: 1fr;
  }
  .knowledge-reader nav {
    max-height: 220px;
  }
}
</style>
