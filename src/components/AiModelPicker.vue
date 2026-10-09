<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api';
const props = defineProps<{ baseUrl: string; apiKey: string; disabled: boolean }>();
const model = defineModel<string>({ required: true });
const models = ref<string[]>([]),
  loading = ref(false),
  error = ref(''),
  loaded = ref(false);
const validUrl = computed(() => {
  try {
    return ['http:', 'https:'].includes(new URL(props.baseUrl.trim()).protocol);
  } catch {
    return false;
  }
});
let serial = 0,
  alive = true,
  timer: ReturnType<typeof setTimeout> | undefined;
async function load() {
  clearTimeout(timer);
  if (!validUrl.value || props.disabled) return;
  const request = ++serial;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<{ models: string[] }>('/ai/models', {
      baseUrl: props.baseUrl.trim(),
      apiKey: props.apiKey.trim(),
    });
    if (!alive || request !== serial) return;
    models.value = result.models;
    loaded.value = true;
  } catch (e) {
    if (alive && request === serial) error.value = (e as Error).message;
  } finally {
    if (alive && request === serial) loading.value = false;
  }
}
watch(
  () => [props.baseUrl, props.apiKey],
  () => {
    ++serial;
    clearTimeout(timer);
    loading.value = false;
    models.value = [];
    error.value = '';
    loaded.value = false;
    if (validUrl.value && props.apiKey.trim()) timer = setTimeout(() => void load(), 650);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  alive = false;
  ++serial;
  clearTimeout(timer);
});
</script>
<template>
  <div class="ai-model-picker">
    <label v-if="models.length"
      >可用模型
      <select v-model="model" aria-label="可用模型" :disabled="disabled || loading">
        <option value="">请选择模型</option>
        <option v-if="model && !models.includes(model)" :value="model">当前填写：{{ model }}</option>
        <option v-for="id in models" :key="id" :value="id">{{ id }}</option>
      </select>
    </label>
    <label
      >模型名称<input
        v-model="model"
        required
        maxlength="120"
        placeholder="选择上方模型，或手动填写名称"
        :disabled="disabled"
    /></label>
    <p v-if="loading" role="status">正在获取模型列表…</p>
    <p v-else-if="error" role="alert" class="small">{{ error }}</p>
    <p v-else-if="loaded" role="status" class="small">
      {{
        models.length
          ? `已获取 ${models.length} 个模型，请选择后保存配置。`
          : '接口暂无可用模型，可刷新列表或手动填写模型名称。'
      }}
    </p>
    <p v-else class="small subtle">填写接口地址和密钥后自动获取模型；无密钥的本地服务可点击刷新。</p>
    <button type="button" :disabled="disabled || loading || !validUrl" @click="load">
      {{ loading ? '获取中…' : error ? '重试获取模型' : '刷新模型列表' }}
    </button>
  </div>
</template>
