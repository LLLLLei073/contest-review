<script setup lang="ts">
import { computed, ref } from 'vue';
import { fullDay } from '../../api';
import type { AgentRecord } from '../../../shared/agent-domain';
const props = defineProps<{
  sessions: Extract<AgentRecord, { kind: 'session' }>[];
  selected: string;
  busy: boolean;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const query = ref('');
function title(s: Extract<AgentRecord, { kind: 'session' }>) {
  return s.context.kind === 'problem'
    ? s.context.problemKey
    : s.context.kind === 'contest'
      ? s.context.source.toUpperCase() + ' · ' + s.context.contestId
      : s.context.kind === 'monthly'
        ? s.context.month + ' 月报'
        : s.title;
}
const filtered = computed(() =>
  props.sessions
    .slice()
    .reverse()
    .filter((s) => title(s).toLowerCase().includes(query.value.toLowerCase())),
);
</script>
<template>
  <label class="small subtle">检索会话<input v-model="query" placeholder="题号、比赛或名称" /></label>
  <div class="astra-session-list" aria-label="会话列表">
    <button
      v-for="s in filtered"
      :key="s.id"
      class="button"
      :class="{ active: selected === s.id }"
      :aria-pressed="selected === s.id"
      :disabled="busy"
      @click="emit('select', s.id)"
    >
      {{ title(s) }}<small>{{ fullDay(s.createdAt) }}</small>
    </button>
    <p v-if="!filtered.length" class="small subtle">没有匹配的会话。</p>
  </div>
</template>
