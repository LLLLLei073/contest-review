<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import Markdown from './Markdown.vue';
import type { LearningRecord } from '../../shared/learning-domain';
const props = defineProps<{ source: 'cf' | 'atcoder' | 'xcpc'; contestId: string }>();
const records = ref<LearningRecord[]>([]),
  error = ref(''),
  busy = ref(false);
async function load() {
  try {
    records.value = (await api<{ records: LearningRecord[] }>('/learning/state')).records
      .filter((r) => r.kind === 'coach' && r.contestKey === props.source + ':' + props.contestId)
      .reverse();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function generate() {
  busy.value = true;
  error.value = '';
  try {
    await api('/learning/coach', { source: props.source, contestId: props.contestId });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
watch(() => props.source + props.contestId, load);
</script>
<template>
  <section class="learning-stack">
    <h2>AI 比赛教练</h2>
    <p class="subtle">
      基于已保存的成绩、时间线与笔记提出策略；建议会作为训练 Agent 的输入，不改变官方成绩。
    </p>
    <button class="small-button" :disabled="busy" @click="generate">
      {{ busy ? '分析中…' : '生成比赛策略建议' }}
    </button>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <RouterLink to="/knowledge?view=training">进入训练 Agent</RouterLink>
    <article v-for="r in records" :key="r.id" class="learning-card">
      <template v-if="r.kind === 'coach'"
        ><p v-for="w in r.warnings" :key="w" class="small subtle">{{ w }}</p>
        <div v-for="(f, i) in r.findings" :key="i">
          <Markdown :text="f.cause" /><Markdown :text="f.action" />
          <p class="small">证据：{{ f.evidenceIds.join('、') }}</p>
          <RouterLink v-for="k in f.knowledgeIds" :key="k" :to="'/knowledge?card=' + k">{{ k }} </RouterLink>
        </div>
        <details>
          <summary>本次分析依据</summary>
          <pre v-for="e in r.evidence" :key="e.id">{{ e.text }}</pre>
        </details></template
      >
    </article>
  </section>
</template>
