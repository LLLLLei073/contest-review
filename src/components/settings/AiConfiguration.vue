<script setup lang="ts">
import { ref, watch } from 'vue';
import { Sparkles } from 'lucide-vue-next';
import { api, notify } from '../../api';
import AiModelPicker from '../AiModelPicker.vue';
const props = defineProps<{ visible: boolean }>();
const error = ref('');
const aiBaseUrl = ref(''),
  aiApiKey = ref(''),
  aiModel = ref(''),
  aiConfigured = ref(false),
  aiBusy = ref(false),
  aiTestResult = ref('');
async function loadAi() {
  const data = await api<{ configured: boolean; baseUrl: string; model: string; apiKey: string }>(
    '/ai/settings',
  );
  aiConfigured.value = data.configured;
  aiBaseUrl.value = data.baseUrl;
  aiModel.value = data.model;
  aiApiKey.value = data.apiKey;
}
async function saveAi() {
  aiBusy.value = true;
  aiTestResult.value = '';
  error.value = '';
  try {
    const data = await api<{ configured: boolean; apiKey: string }>(
      '/ai/settings',
      { baseUrl: aiBaseUrl.value.trim(), apiKey: aiApiKey.value.trim(), model: aiModel.value.trim() },
      'PUT',
    );
    aiConfigured.value = data.configured;
    aiApiKey.value = data.apiKey;
    notify('AI 配置已保存');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    aiBusy.value = false;
  }
}
async function testAi() {
  aiBusy.value = true;
  aiTestResult.value = '';
  error.value = '';
  try {
    const data = await api<{ ok: boolean; message: string }>('/ai/test', {
      baseUrl: aiBaseUrl.value.trim(),
      apiKey: aiApiKey.value.trim(),
      model: aiModel.value.trim(),
    });
    aiTestResult.value = data.message;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    aiBusy.value = false;
  }
}
async function testTools() {
  aiBusy.value = true;
  aiTestResult.value = '';
  try {
    const r = await api<{ message: string }>('/ai/capabilities', {
      baseUrl: aiBaseUrl.value.trim(),
      apiKey: aiApiKey.value.trim(),
      model: aiModel.value.trim(),
    });
    aiTestResult.value = r.message;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    aiBusy.value = false;
  }
}
const aiLoaded = ref(false),
  aiLoading = ref(false);
async function ensureAiConfiguration() {
  if (aiLoaded.value || aiLoading.value) return;
  aiLoading.value = true;
  error.value = '';
  try {
    await loadAi();
    aiLoaded.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    aiLoading.value = false;
  }
}
watch(
  () => props.visible,
  (value) => {
    if (value) void ensureAiConfiguration();
  },
  { immediate: true },
);
</script>
<template>
  <div v-if="error && visible" role="alert" class="alert error">{{ error }}</div>
  <section class="panel settings-card">
    <div class="section-head">
      <div class="section-title">
        <span class="section-icon"><Sparkles :size="20" /></span>
        <div>
          <h2>AI 助手配置</h2>
          <p>配置任意 OpenAI 兼容接口后，可在题目详情页让 AI 分析错误代码。</p>
        </div>
      </div>
      <span v-if="aiConfigured" class="badge mastered">已配置</span>
    </div>
    <form class="handle-form ai-form" @submit.prevent="saveAi">
      <ol class="ai-setup-steps">
        <li>填写接口地址与密钥，本地服务可不填密钥。</li>
        <li>自动获取模型或手动填写模型名。</li>
        <li>测试连接与工具能力，最后保存配置。</li>
      </ol>
      <p class="small subtle">测试使用当前输入，不会保存凭据。ReAct 需要工具调用能力；普通分析可单独使用。</p>
      <label
        >接口地址 Base URL<input
          v-model="aiBaseUrl"
          required
          maxlength="300"
          placeholder="例如 https://api.deepseek.com/v1"
          :disabled="aiBusy || !aiLoaded" /></label
      ><label
        >API 密钥<input
          v-model="aiApiKey"
          type="password"
          maxlength="300"
          placeholder="sk-…（本地服务可留空）"
          autocomplete="off"
          :disabled="aiBusy || !aiLoaded"
      /></label>
      <p v-if="aiLoading" role="status">正在读取 AI 配置…</p>
      <button v-else-if="!aiLoaded" type="button" @click="ensureAiConfiguration">重试读取 AI 配置</button>
      <AiModelPicker
        v-if="aiLoaded"
        v-model="aiModel"
        :base-url="aiBaseUrl"
        :api-key="aiApiKey"
        :disabled="aiBusy"
      />
      <div class="button-row">
        <button class="primary" :disabled="aiBusy || !aiLoaded">保存配置</button
        ><button type="button" :disabled="aiBusy || !aiLoaded || !aiBaseUrl || !aiModel" @click="testAi">
          {{ aiBusy ? '请求中…' : '测试当前配置' }}
        </button>
        <button type="button" :disabled="aiBusy || !aiLoaded || !aiBaseUrl || !aiModel" @click="testTools">
          测试工具调用能力
        </button>
      </div>
    </form>
    <p v-if="aiTestResult" class="alert success">{{ aiTestResult }}</p>
    <p class="small subtle">
      密钥只保存在本地数据库，并随备份导出。兼容 OpenAI 格式的服务均可使用，例如
      DeepSeek（https://api.deepseek.com/v1）、Kimi（https://api.moonshot.cn/v1）或本地
      Ollama（http://127.0.0.1:11434/v1）。AI 分析结果仅供参考，请以评测与独立重做为准。
    </p>
  </section>
</template>
