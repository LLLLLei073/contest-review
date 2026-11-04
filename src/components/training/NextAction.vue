<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { ArrowRight, CheckCircle2, Compass } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { api, settings, dataRevision, fullDate } from '../../api';
import type { TrainingContinuation } from '../../../shared/training-continuation';
import { nextTrainingAction } from '../../../shared/workbench';
import type { TrainingDay } from '../../../shared/training';
const props = defineProps<{ day: TrainingDay | null; cf: boolean; atcoder: boolean }>();
defineEmits<{ goal: [] }>();
const fallback = computed(() => nextTrainingAction(props.day, { cf: props.cf, atcoder: props.atcoder }));
const router = useRouter();
const continuations = ref<TrainingContinuation[]>([]),
  error = ref('');
let serial = 0;
async function load() {
  const token = ++serial;
  continuations.value = [];
  try {
    const rows = await api<TrainingContinuation[]>('/training/continuations');
    if (token === serial) continuations.value = rows;
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  }
}
watch(
  () => [
    settings.value.activeHandle,
    settings.value.activeAtcoder,
    settings.value.xcpcPlayer?.key,
    dataRevision.value,
    props.day,
  ],
  load,
  { immediate: true },
);
onBeforeUnmount(() => {
  serial++;
});
const main = computed(() =>
  props.day?.review.some((task) => !task.completed && task.phase === 'evaluation')
    ? null
    : continuations.value[0],
);
const action = computed(() =>
  main.value
    ? {
        kind: 'continuation',
        title: main.value.title,
        reason: main.value.stage + ' · ' + fullDate(main.value.updatedAt),
        label: '继续上次训练',
        href: main.value.href,
      }
    : fallback.value,
);
const others = computed(() => continuations.value.filter((row) => row.id !== main.value?.id));
async function resume(row: TrainingContinuation) {
  const token = serial;
  try {
    const rows = await api<TrainingContinuation[]>('/training/continuations');
    if (token !== serial) return;
    continuations.value = rows;
    const valid = rows.find((r) => r.id === row.id && r.kind === row.kind);
    if (!valid) {
      error.value = '这项训练已完成或失效，列表已刷新。';
      return;
    }
    await router.push(valid.href);
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  }
}
</script>
<template>
  <section v-if="action" class="next-action" aria-label="下一步训练建议">
    <div class="next-action-icon">
      <CheckCircle2 v-if="action.kind === 'complete'" :size="23" /><Compass v-else :size="23" />
    </div>
    <div class="next-action-copy">
      <span class="eyebrow">{{ action.kind === 'complete' ? '今日收获' : '下一步 · 从这里继续' }}</span>
      <h2>{{ action.title }}</h2>
      <p>{{ action.reason }}</p>
    </div>
    <button v-if="main" class="primary" @click="resume(main)">继续上次训练<ArrowRight :size="16" /></button>
    <button v-else-if="action.kind === 'goal'" class="primary" @click="$emit('goal')">
      {{ action.label }}<ArrowRight :size="16" />
    </button>
    <a
      v-else-if="action.kind === 'new'"
      :href="action.href"
      target="_blank"
      rel="noreferrer"
      class="button primary"
      >{{ action.label }}<ArrowRight :size="16"
    /></a>
    <RouterLink v-else :to="action.href!" class="button primary"
      >{{ action.label }}<ArrowRight :size="16"
    /></RouterLink>
  </section>
  <p v-if="error" role="status">{{ error }} <button @click="load">刷新续接列表</button></p>
  <details v-if="others.length" class="panel">
    <summary>其他未完成训练（{{ others.length }}）</summary>
    <ul>
      <li v-for="row in others" :key="row.kind + row.id">
        <button class="text-link" @click="resume(row)">{{ row.title }} · {{ row.stage }}</button> ·
        {{ fullDate(row.updatedAt) }}
      </li>
    </ul>
  </details>
</template>
<style scoped>
.next-action {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px 24px;
  margin-bottom: 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--highlight);
  border-radius: 12px;
  background: var(--paper);
}
.next-action-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  color: var(--highlight);
  background: var(--accent-soft);
  border-radius: 12px;
}
.next-action-copy {
  min-width: 0;
  flex: 1;
}
.next-action h2 {
  font-size: 18px;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.next-action p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  max-width: 70ch;
}
.next-action .button,
.next-action > button {
  flex-shrink: 0;
}
@media (max-width: 650px) {
  .next-action {
    padding: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .next-action-icon {
    display: none;
  }
  .next-action-copy {
    flex-basis: 100%;
  }
  .next-action h2 {
    font-size: 16px;
  }
  .next-action .button,
  .next-action > button {
    width: 100%;
  }
}
</style>
