<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { KnowledgeCard } from '../../../shared/knowledge';
import type { ExperienceCard } from '../../../shared/learning-domain';
import Markdown from '../Markdown.vue';
const props = defineProps<{
  cards: KnowledgeCard[];
  all: KnowledgeCard[];
  experiences: (ExperienceCard & { sourceValid: boolean })[];
}>();
const emit = defineEmits<{
  graph: [id: string];
  experience: [id: string];
  ask: [question: string];
}>();
const route = useRoute();
const selected = computed(() => props.cards.find((c) => c.id === route.query.card) ?? props.cards[0]);
const successors = computed(() =>
  props.all.filter((c) => c.prerequisites.includes(selected.value?.id ?? '')),
);
const related = computed(() =>
  props.experiences.filter((c) => c.knowledgeIds.includes(selected.value?.id ?? '')),
);
const cardLink = (id: string) => ({
  path: '/knowledge',
  query: { ...route.query, view: 'library', card: id, experience: undefined },
});
</script>
<template>
  <div v-if="cards.length" class="knowledge-reader">
    <nav class="panel knowledge-index" aria-label="知识目录">
      <div class="index-heading">
        <span class="eyebrow">ALGORITHM INDEX</span>
        <p>{{ cards.length }} 个知识点 <span>· 离线可读</span></p>
      </div>
      <RouterLink
        v-for="(card, index) in cards"
        :key="card.id"
        :to="cardLink(card.id)"
        :aria-current="selected?.id === card.id ? 'page' : undefined"
      >
        <span class="index-number">{{ String(index + 1).padStart(2, '0') }}</span>
        <span
          ><strong>{{ card.title }}</strong
          ><small>{{ card.category }}</small></span
        >
      </RouterLink>
    </nav>
    <article
      v-if="selected"
      class="panel learning-card knowledge-article"
      :id="selected.id"
      aria-label="知识正文"
    >
      <header class="reading-head">
        <span class="eyebrow">{{ selected.category }}</span>
        <h2>{{ selected.title }}</h2>
        <p class="reading-summary">{{ selected.summary }}</p>
        <div class="alias-list">
          <span v-for="alias in selected.aliases" :key="alias">{{ alias }}</span>
        </div>
      </header>
      <div class="reading-actions">
        <RouterLink :to="{ path: '/battle', query: { skill: selected.id } }" class="button"
          >开始连战 →</RouterLink
        >
        <RouterLink :to="{ path: '/problems', query: { tag: selected.tags[0] } }" class="small-button"
          >查找相关练习 →</RouterLink
        >
        <button
          class="small-button"
          @click="emit('ask', '请结合我的复盘，解释' + selected.title + '的适用条件和常见错误。')"
        >
          围绕此知识提问
        </button>
      </div>
      <Markdown :text="selected.content" />
      <section class="knowledge-connections" aria-label="关联学习">
        <div>
          <h3>先修知识</h3>
          <p v-if="!selected.prerequisites.length" class="small subtle">可从这里开始学习。</p>
          <div class="connection-links">
            <RouterLink v-for="id in selected.prerequisites" :key="id" :to="cardLink(id)"
              >{{ all.find((c) => c.id === id)?.title ?? id }} <span>↗</span></RouterLink
            >
          </div>
        </div>
        <div>
          <h3>后续知识</h3>
          <p v-if="!successors.length" class="small subtle">用不同题目验证，再回到学习路径选择下一步。</p>
          <div class="connection-links">
            <RouterLink v-for="card in successors" :key="card.id" :to="cardLink(card.id)"
              >{{ card.title }} <span>↗</span></RouterLink
            >
          </div>
        </div>
      </section>
      <section class="related-experiences">
        <h3>
          关联个人经验 <span class="small subtle" aria-hidden="true">{{ related.length }}</span>
        </h3>
        <p v-if="!related.length" class="small subtle">
          还没有关联经验。完成相关题目后，可在解题助手中沉淀经验卡。
        </p>
        <button
          v-for="card in related"
          :key="card.id"
          class="related-experience"
          @click="emit('experience', card.id)"
        >
          <span>{{ card.title }}</span
          ><small
            >{{ !card.sourceValid ? '来源已失效' : card.confirmed ? '已确认' : '草稿' }} · 查看与编辑 ↗</small
          >
        </button>
      </section>
      <footer class="reading-footer">
        <button class="small-button" @click="emit('graph', selected.id)">查看关联</button>
        <RouterLink to="/?view=path" class="small-button">查看学习路径 →</RouterLink>
        <span class="small subtle">阅读与问答不计为独立完成证据</span>
      </footer>
    </article>
  </div>
  <p v-else class="quiet-empty">没有匹配的内置知识，试试别名或其他领域。</p>
</template>
<style scoped>
.knowledge-reader {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.knowledge-index {
  padding: 12px;
  max-height: 720px;
  overflow: auto;
  position: sticky;
  top: 20px;
}
.index-heading {
  padding: 12px 12px 16px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 8px;
}
.index-heading p {
  margin: 8px 0 0;
  font-weight: 650;
}
.index-heading p span {
  color: var(--muted);
  font-weight: 400;
  font-size: 12px;
}
.knowledge-index a {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 12px;
  border-radius: 6px;
  color: var(--ink);
  text-decoration: none;
  border-left: 2px solid transparent;
}
.knowledge-index a:hover {
  background: var(--wash);
}
.knowledge-index a[aria-current] {
  background: var(--accent-soft);
  border-left-color: var(--highlight);
  color: var(--highlight);
}
.index-number {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.knowledge-index strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
}
.knowledge-index small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}
.knowledge-article {
  min-width: 0;
  padding: 28px;
}
.reading-head h2 {
  margin: 10px 0;
  font-size: 28px;
  letter-spacing: -0.03em;
}
.reading-summary {
  color: var(--muted);
  font-size: 15px;
  line-height: 1.8;
  margin: 0 0 14px;
}
.alias-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.alias-list span {
  font-size: 11px;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 3px 7px;
  color: var(--muted);
}
.reading-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 20px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.knowledge-article :deep(.markdown h3) {
  margin: 28px 0 12px;
  padding-left: 12px;
  border-left: 2px solid var(--highlight);
  font-size: 16px;
}
.knowledge-article :deep(.markdown) {
  font-size: 14px;
  line-height: 1.9;
}
.knowledge-connections {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  border-top: 1px solid var(--line);
  padding-top: 24px;
  margin-top: 28px;
}
.knowledge-connections h3,
.related-experiences h3 {
  font-size: 14px;
  margin: 0 0 12px;
}
.connection-links {
  display: grid;
  gap: 6px;
}
.connection-links a {
  display: flex;
  justify-content: space-between;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 5px;
  text-decoration: none;
}
.related-experiences {
  border-top: 1px solid var(--line);
  margin-top: 24px;
  padding-top: 24px;
}
.related-experience {
  display: flex;
  width: 100%;
  text-align: left;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  border: 0;
  background: var(--wash);
  color: var(--ink);
  border-radius: 5px;
  padding: 12px;
  margin-top: 6px;
  cursor: pointer;
}
.related-experience small {
  color: var(--muted);
}
.reading-footer {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  border-top: 1px solid var(--line);
  margin-top: 24px;
  padding-top: 18px;
}
.reading-actions .small-button,
.reading-footer .small-button {
  font-size: 12px;
}
@media (max-width: 1000px) {
  .knowledge-reader {
    grid-template-columns: 190px minmax(0, 1fr);
  }
  .knowledge-article {
    padding: 20px;
  }
  .related-experience {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}
@media (max-width: 700px) {
  .knowledge-reader {
    grid-template-columns: 1fr;
  }
  .knowledge-index {
    position: static;
    max-height: 240px;
  }
  .knowledge-index a {
    padding: 10px 12px;
  }
  .knowledge-article {
    padding: 18px;
  }
  .reading-head h2 {
    font-size: 24px;
  }
  .knowledge-connections {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
