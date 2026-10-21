<script setup lang="ts">
import type { BatchJob } from '../../../shared/xcpc';
defineProps<{ batch: BatchJob | null; busy: boolean }>();
const emit = defineEmits<{ stop: []; resume: [] }>();
</script>
<template>
  <div v-if="batch" :class="['alert', { error: batch.status === 'failed' }]" role="status">
    {{ batch.phase }} · 已处理 {{ batch.processed }} / {{ batch.total }} · 成功 {{ batch.succeeded }} · 失败
    {{ batch.failed }} <button v-if="batch.status === 'running'" @click="emit('stop')">停止</button>
    <progress :value="batch.processed" :max="Math.max(1, batch.total)" aria-label="批量复盘进度"></progress>
    <button
      v-if="batch.status !== 'running' && (batch.failed || batch.processed < batch.total)"
      class="small-button"
      :disabled="busy"
      @click="emit('resume')"
    >
      继续处理未完成项
    </button>
    <p class="small">已生成的报告保留；继续时复用有效缓存，处理失败不会清空旧报告。</p>
    <details v-if="batch.errors.length">
      <summary>查看失败项</summary>
      <p v-for="e in batch.errors" :key="e">{{ e }}</p>
    </details>
  </div>
</template>
