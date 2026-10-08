<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { downloadFiles } from '../learning';
import type { LearningRecord } from '../../shared/learning-domain';
import type { AiReviewRecord } from '../../shared/ai-review';
import Markdown from './Markdown.vue';
const props = defineProps<{
  problemKey: string;
  code: string;
  language: string;
  statement: string;
  aiReviews: AiReviewRecord[];
}>();
const records = ref<LearningRecord[]>([]),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  statement = ref(props.statement),
  idea = ref(''),
  sourceId = ref('');
const hints = computed(() =>
  records.value
    .filter((r) => r.kind === 'hint' && r.problemKey === props.problemKey)
    .slice()
    .reverse(),
);
const bundles = computed(() =>
  records.value
    .filter((r) => r.kind === 'bundle' && r.problemKey === props.problemKey)
    .slice()
    .reverse(),
);
async function load() {
  records.value = (await api<{ records: LearningRecord[] }>('/learning/state')).records;
}
async function run(action: string, input: unknown) {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const r = await api<{ message?: string }>('/learning/' + action, input);
    message.value = r.message || '已完成';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function download(id: string) {
  try {
    downloadFiles('stress-' + id + '.zip', await api('/learning/files', { id }));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function importReport(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 500000) throw new Error('报告不能超过 500 KB');
    await run('report', JSON.parse(await file.text()));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    input.value = '';
  }
}
onMounted(() => load().catch((e) => (error.value = e.message)));
</script>
<template>
  <div class="learning-stack">
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="learning-controls">
      <RouterLink to="/knowledge">知识与经验库</RouterLink
      ><RouterLink to="/knowledge?view=diagnosis">学情诊断</RouterLink
      ><RouterLink to="/knowledge?view=training">训练 Agent</RouterLink>
    </div>
    <section class="learning-stack">
      <h2>沉淀个人经验</h2>
      <label
        >经验来源<select v-model="sourceId">
          <option value="">已保存的复盘与代码</option>
          <option v-for="r in aiReviews" :key="r.id" :value="r.id">
            AI 分析 · {{ new Date(r.createdAt).toLocaleString('zh-CN') }}
          </option>
        </select></label
      ><button
        class="small-button"
        :disabled="busy"
        @click="run('draft', { problemKey, sourceId: sourceId || undefined })"
      >
        生成经验卡草稿
      </button>
      <p class="small subtle">AI 分析先转成草稿，在知识中心核对确认后才能参与检索。</p>
    </section>
    <section class="learning-stack">
      <h2>渐进式提示</h2>
      <label
        >题面与输入输出约束<textarea
          v-model="statement"
          rows="5"
          maxlength="20000"
          placeholder="提示与对拍共用这份题面"
        /></label
      ><label>我目前的思路<textarea v-model="idea" rows="2" maxlength="2000" /></label>
      <div class="button-row">
        <button
          v-for="(label, i) in ['方向提示', '关键观察', '算法思路', '完整题解']"
          :key="label"
          class="small-button"
          :disabled="busy"
          @click="run('hint', { problemKey, statement, idea, level: i + 1 })"
        >
          {{ i + 1 }}. {{ label }}
        </button>
      </div>
      <p class="small subtle">提示按顺序解锁。本次练习使用提示后，评价采用“借助提示”，不推进独立完成阶段。</p>
      <details v-for="h in hints" :key="h.id">
        <template v-if="h.kind === 'hint'"
          ><summary>第 {{ h.level }} 级 · {{ new Date(h.createdAt).toLocaleString('zh-CN') }}</summary>
          <Markdown :text="h.content"
        /></template>
      </details>
    </section>
    <section class="learning-stack">
      <h2>反例与对拍</h2>
      <p class="small subtle">
        使用 AI 复盘输入区的代码与语言生成对拍包。支持 C++17 / Python 3；下载后审阅代码，在本机执行，再导入
        report.json。生成内容尚未验证。
      </p>
      <button
        class="small-button"
        :disabled="busy || !['cpp', 'python'].includes(language)"
        @click="run('bundle', { problemKey, code, language, statement })"
      >
        生成对拍包</button
      ><label>导入本机对拍报告<input type="file" accept=".json" @change="importReport" /></label>
      <article v-for="b in bundles" :key="b.id" class="learning-card panel">
        <template v-if="b.kind === 'bundle'"
          ><h3>{{ b.language }} · {{ new Date(b.createdAt).toLocaleString('zh-CN') }}</h3>
          <p>
            {{
              b.status === 'suggested'
                ? 'AI 建议 · 未运行'
                : b.status === 'user-verified'
                  ? '用户报告已验证'
                  : '验证失败'
            }}
          </p>
          <button class="small-button" @click="download(b.id)">下载对拍 ZIP</button>
          <details>
            <summary>审阅参考解与生成器</summary>
            <pre>{{ b.oracle }}</pre>
            <pre>{{ b.generator }}</pre>
          </details>
          <div v-for="(r, i) in b.reports" :key="i">
            <p>用户本机报告：{{ r.status }} · seed {{ r.seed }} · 第 {{ r.round }} 轮</p>
            <p>{{ r.message }}</p>
            <details>
              <summary>输入与输出</summary>
              <pre>{{ r.input }}</pre>
              <pre>参考输出：{{ r.expected }}\n待测输出：{{ r.actual }}</pre>
            </details>
          </div></template
        >
      </article>
    </section>
    <section>
      <h2>验证迁移能力</h2>
      <p class="small subtle">推荐未做过的相关变式题，安排到次日新知栏，并保持每日最多五道新知题。</p>
      <button class="small-button" :disabled="busy" @click="run('transfer', { problemKey })">
        安排迁移检测
      </button>
      <RouterLink to="/knowledge?view=transfers">查看迁移任务与评价</RouterLink>
    </section>
  </div>
</template>
