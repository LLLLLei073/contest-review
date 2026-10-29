<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { fullDate } from '../../api';
import type { AgentRecord } from '../../../shared/agent-domain';
const open = defineModel<boolean>({ required: true }),
  memories = defineModel<Extract<AgentRecord, { kind: 'memory' }>[]>('memories', { required: true }),
  preferences = defineModel<{ memory: boolean; proactive: boolean }>('preferences', { required: true });
defineProps<{ busy: boolean }>();
const emit = defineEmits<{
  save: [memory: Extract<AgentRecord, { kind: 'memory' }>];
  remove: [id: string];
  settings: [];
}>();
const dialog = ref<HTMLDialogElement>();
watch(
  open,
  async (value) => {
    await nextTick();
    if (value) dialog.value?.showModal();
    else dialog.value?.close();
  },
  { immediate: true },
);
</script>
<template>
  <dialog ref="dialog" class="memory-drawer" aria-labelledby="memory-title" @close="open = false">
    <div class="section-head">
      <h2 id="memory-title">记忆与偏好</h2>
      <button class="small-button" @click="open = false">关闭记忆面板</button>
    </div>
    <p class="subtle small">只记住你明确表达的目标与习惯。成绩和掌握度每次从真实记录读取。</p>
    <label
      ><input v-model="preferences.memory" :disabled="busy" type="checkbox" @change="emit('settings')" />
      使用长期记忆</label
    ><label
      ><input v-model="preferences.proactive" :disabled="busy" type="checkbox" @change="emit('settings')" />
      开启站内主动建议</label
    >
    <p class="small subtle">默认关闭主动建议；开启后每天最多两次，仅在应用打开时运行。</p>
    <article v-for="m in memories" :key="m.id" class="astra-memory-item">
      <label :for="'memory-' + m.id">已记住的偏好</label
      ><textarea :id="'memory-' + m.id" v-model="m.content" rows="3" maxlength="2000" />
      <p class="small subtle">来源：用户明确表达 · {{ fullDate(m.createdAt) }}</p>
      <details>
        <summary>来源消息编号</summary>
        <code>{{ m.sourceId }}</code>
      </details>
      <div class="button-row">
        <button class="button small" :disabled="busy" @click="emit('save', m)">保存记忆</button
        ><button class="button small" :disabled="busy" @click="emit('remove', m.id)">删除记忆</button>
      </div>
    </article>
    <p v-if="!memories.length" class="subtle">还没有长期记忆。可以说“请记住：……”告诉我。</p>
  </dialog>
</template>
<style scoped>
.memory-drawer {
  position: fixed;
  inset: 16px 16px 16px auto;
  margin: 0;
  width: min(430px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 24px;
  background: var(--paper);
  color: var(--ink);
  overflow: auto;
}
.memory-drawer::backdrop {
  background: #101a2b66;
}
.memory-drawer > label {
  display: block;
  margin: 16px 0;
}
.memory-drawer code {
  overflow-wrap: anywhere;
}
</style>
