<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LearningEvidence } from '../../../shared/learning-evidence';
const props = defineProps<{ events: LearningEvidence[] }>();
const filter = ref('all');
const visible = computed(() => props.events.filter((e) => filter.value === 'all' || e.kind === filter.value));
const labels = {
  submission: '提交',
  attempt: '重做评价',
  reflection: '有效复盘',
  assistance: '提示帮助',
  experience: '经验卡',
  verification: '运行验证',
  transfer: '迁移练习',
};
</script>
<template>
  <section class="evidence-timeline editor-body">
    <h2>学习证据时间线</h2>
    <p class="subtle">区分系统记录、用户报告与待验证材料。时间不明确的记录放在末尾，避免误导先后关系。</p>
    <label
      >记录类型<select v-model="filter">
        <option value="all">全部证据</option>
        <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
      </select></label
    >
    <p v-if="!visible.length" class="quiet-empty">此类型暂时没有记录。</p>
    <ol>
      <li v-for="event in visible" :key="event.id">
        <time>{{ event.at ? new Date(event.at).toLocaleString('zh-CN') : '时间未记录' }}</time>
        <div>
          <h3>{{ event.title }}</h3>
          <span class="badge">{{
            event.status === 'observed' ? '原始记录' : event.status === 'draft' ? '待验证材料' : '用户报告'
          }}</span>
          <p>{{ event.summary }}</p>
          <RouterLink :to="event.href">查看来源 →</RouterLink>
        </div>
      </li>
    </ol>
  </section>
</template>
<style scoped>
.evidence-timeline > label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  margin: 20px 0;
}
.evidence-timeline ol {
  list-style: none;
  padding: 0;
}
.evidence-timeline li {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 20px;
  padding: 24px 0;
  border-top: 1px solid var(--line);
}
.evidence-timeline time {
  font-size: 12px;
  color: var(--muted);
}
.evidence-timeline h3 {
  font-size: 15px;
  margin: 0 0 8px;
}
.evidence-timeline p {
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.evidence-timeline a {
  font-size: 13px;
}
@media (max-width: 650px) {
  .evidence-timeline li {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>
