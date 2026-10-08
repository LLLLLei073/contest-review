<script setup lang="ts">
import { computed, ref } from 'vue';
import Markdown from './Markdown.vue';
import type { useLearningState } from '../learningState';
const props = defineProps<{ mode: string; session: ReturnType<typeof useLearningState> }>();
const { state, loading, busy, error, message, load, run } = props.session;
const records = computed(() => state.value?.records ?? []);
const auto = computed(() => records.value.some((r) => r.kind === 'preferences' && r.auto));
const period = ref<'30' | 'all'>('30');
const transferMinutes = ref<Record<string, number>>({});
const transferLabels = { pending: '待验证', independent: '独立完成', hint: '借助提示', failed: '未完成' };
async function evaluate(id: string, result: 'independent' | 'hint' | 'failed') {
  await run('transfer-result', { id, result, minutes: Number(transferMinutes.value[id] || 0) });
}
</script>
<template>
  <div v-if="loading" class="quiet-empty" role="status">正在读取学习记录…</div>
  <div v-if="error" class="alert error" role="alert">{{ error }} <button @click="load">重试</button></div>
  <p v-if="message" role="status">{{ message }}</p>
  <p v-if="state && !state.configured" class="alert">
    生成内容需先<RouterLink to="/settings?view=ai">配置 AI 接口</RouterLink>；已有记录仍可浏览。
  </p>
  <p v-if="mode === 'diagnosis'" class="subtle">依据复盘与训练证据，找到下一步需要改进的方向。</p>
  <p v-if="mode === 'transfers' && !records.some((r) => r.kind === 'transfer')" class="quiet-empty">
    还没有迁移练习。到<RouterLink to="/problems">错题库</RouterLink>打开题目的解题助手，安排相关变式题。
  </p>
  <section v-if="mode === 'diagnosis'" class="learning-stack">
    <div class="learning-controls">
      <label
        >诊断范围<select v-model="period">
          <option value="30">最近 30 天</option>
          <option value="all">全部历史</option>
        </select></label
      ><button class="button" :disabled="busy" @click="run('diagnose', { period })">生成学情诊断</button>
    </div>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'diagnosis')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'diagnosis'"
        ><h2>
          {{ r.period === '30' ? '近 30 天' : '全部历史' }} ·
          {{ new Date(r.createdAt).toLocaleString('zh-CN') }}
        </h2>
        <p v-for="w in r.warnings" :key="w" class="subtle">{{ w }}</p>
        <div v-for="(f, i) in r.findings" :key="i">
          <Markdown :text="f.cause" /><Markdown :text="f.action" />
          <details>
            <summary>查看诊断证据</summary>
            <div v-for="id in f.evidenceIds" :key="id">
              <p>{{ r.evidence.find((e) => e.id === id)?.text ?? id }}</p>
              <RouterLink
                v-if="id.startsWith('problem:')"
                :to="'/problems/' + encodeURIComponent(id.slice(8))"
                >查看原始复盘</RouterLink
              >
            </div>
          </details>
          <RouterLink v-for="k in f.knowledgeIds" :key="k" :to="'/knowledge?card=' + k"
            >{{ state?.knowledge.find((n) => n.id === k)?.title }}
          </RouterLink>
        </div></template
      >
    </article>
  </section>
  <section v-if="mode === 'training'" class="learning-stack">
    <div class="panel learning-card learning-stack">
      <h2>次日训练计划</h2>
      <p>AI 依据训练反馈与比赛建议调整未来题单。当天题单保持稳定，每栏最多五题，失败时沿用规则推荐。</p>
      <label
        ><input
          type="checkbox"
          :checked="auto"
          :disabled="busy"
          @change="run('preferences', { auto: !auto })"
        />自动调整次日计划（仅在应用运行时触发）</label
      ><button class="button" :disabled="busy" @click="run('agent', { automatic: false })">
        生成次日计划</button
      ><RouterLink to="/">查看今日题单与周目标</RouterLink>
    </div>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'revision' || r.kind === 'agent-run')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'revision'"
        ><h3>{{ r.date }} · {{ r.reverted ? '已撤回' : '计划修订' }}</h3>
        <Markdown :text="r.reason" />
        <p>调整前：{{ r.before.newKeys.join('、') }}</p>
        <p>调整后：{{ r.after.newKeys.join('、') }}</p>
        <details>
          <summary>输入摘要</summary>
          <pre>{{ r.inputSummary }}</pre>
        </details>
        <button class="small-button" :disabled="busy || r.reverted" @click="run('revert', { id: r.id })">
          撤回此版本
        </button></template
      >
      <p v-else-if="r.kind === 'agent-run'">
        {{ new Date(r.createdAt).toLocaleString('zh-CN') }} · {{ r.message }}
      </p>
    </article>
  </section>
  <section v-if="mode === 'transfers'" class="learning-stack">
    <p class="subtle">
      从题目详情推荐相关变式题，占用次日新知名额。标签相关不代表严格等价，独立完成须有同步 AC 证据。
    </p>
    <article
      v-for="r in records
        .filter((r) => r.kind === 'transfer')
        .slice()
        .reverse()"
      :key="r.id"
      class="panel learning-card"
    >
      <template v-if="r.kind === 'transfer'"
        ><h2>{{ r.targetKey }} · {{ r.date }}</h2>
        <p>{{ r.reason }}</p>
        <div class="button-row">
          <RouterLink :to="'/problems/' + encodeURIComponent(r.problemKey)">原始复盘</RouterLink
          ><a
            :href="'https://codeforces.com/problemset/problem/' + r.targetKey.replace(':', '/')"
            target="_blank"
            rel="noreferrer"
            >打开迁移题</a
          >
        </div>
        <p>结果：{{ transferLabels[r.result] }}</p>
        <div v-if="r.result === 'pending'" class="learning-controls">
          <label
            >迁移练习用时（分钟）<input
              v-model="transferMinutes[r.id]"
              type="number"
              min="0"
              max="100000" /></label
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'independent')">
            独立完成</button
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'hint')">借助提示</button
          ><button class="small-button" :disabled="busy" @click="evaluate(r.id, 'failed')">未完成</button>
        </div></template
      >
    </article>
  </section>
</template>
