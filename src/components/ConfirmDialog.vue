<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useConfirm } from '../composables/useConfirm';
const { open, message, settleConfirm } = useConfirm();
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
  <dialog
    ref="dialog"
    class="confirm-dialog"
    aria-label="操作确认"
    @close="settleConfirm(false)"
    @cancel.prevent="settleConfirm(false)"
  >
    <p>{{ message }}</p>
    <div class="button-row">
      <button @click="settleConfirm(false)">取消</button>
      <button class="primary" @click="settleConfirm(true)">确定</button>
    </div>
  </dialog>
</template>
<style scoped>
.confirm-dialog {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 26px 28px;
  max-width: min(420px, calc(100vw - 48px));
  color: var(--ink, inherit);
  background: var(--paper, canvas);
}
.confirm-dialog::backdrop {
  background: color-mix(in srgb, var(--accent-soft, #000) 33%, transparent);
  backdrop-filter: blur(3px);
}
.confirm-dialog p {
  margin: 0 0 22px;
  line-height: 1.8;
  white-space: pre-line;
}
.confirm-dialog .button-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
