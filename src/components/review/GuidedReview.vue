<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, settings, dataRevision } from '../../api';
import { streamAgent } from '../../agent';
import type { AgentContext, AgentEvent, AgentRecord } from '../../../shared/agent-domain';
import {
  reviewWorkflowSchema,
  reviewStages,
  type ReviewWorkflow,
} from '../../../shared/review-workflow-domain';
import { stageLabels } from '../../../shared/review-workflow';
import ProposalCard from '../agent/ProposalCard.vue';
const props = defineProps<{ context: AgentContext; sessionId?: string }>();
const emit = defineEmits<{ busy: [value: boolean]; updated: []; skip: [] }>();
const workflow = ref<ReviewWorkflow>(),
  sessionId = ref(''),
  busy = ref(false),
  loading = ref(false),
  answer = ref(''),
  error = ref(''),
  events = ref<AgentEvent[]>([]),
  records = ref<AgentRecord[]>([]);
const proposals = computed(() =>
  records.value.filter(
    (r): r is Extract<AgentRecord, { kind: 'proposal' }> =>
      r.kind === 'proposal' && !!workflow.value?.proposalIds.includes(r.id),
  ),
);
const scope = computed(() =>
  JSON.stringify([
    settings.value.activeHandle,
    settings.value.activeAtcoder,
    settings.value.xcpcPlayer?.key,
    dataRevision.value,
    props.context,
    props.sessionId,
  ]),
);
let serial = 0,
  controller: AbortController | undefined;
watch(busy, (value) => emit('busy', value));
async function read() {
  if (!sessionId.value) return;
  const token = serial;
  const [w, history] = await Promise.all([
    api<unknown>('/agent/review/session?sessionId=' + encodeURIComponent(sessionId.value)),
    api<AgentRecord[]>('/agent/history?sessionId=' + encodeURIComponent(sessionId.value)),
  ]);
  if (token !== serial) return;
  workflow.value = w ? reviewWorkflowSchema.parse(w) : undefined;
  records.value = history;
}
async function load() {
  const token = ++serial;
  controller?.abort();
  busy.value = false;
  loading.value = true;
  workflow.value = undefined;
  records.value = [];
  answer.value = '';
  error.value = '';
  try {
    const sessions = await api<Extract<AgentRecord, { kind: 'session' }>[]>('/agent/sessions');
    if (token !== serial) return;
    sessionId.value =
      props.sessionId ??
      sessions.findLast((s) => JSON.stringify(s.context) === JSON.stringify(props.context))?.id ??
      '';
    await read();
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  } finally {
    if (token === serial) loading.value = false;
  }
}
async function generate() {
  if (busy.value || workflow.value?.status !== 'ready') return;
  const token = serial;
  busy.value = true;
  error.value = '';
  events.value = [];
  controller = new AbortController();
  try {
    await streamAgent(
      {
        sessionId: sessionId.value,
        workflowId: workflow.value.id,
        requestId: crypto.randomUUID(),
        message: '请按当前阶段查证资料，保存检查点并等待我的回答。',
      },
      (event) => {
        if (token !== serial) return;
        events.value.push(event);
        if (event.type === 'error') error.value = event.text ?? '步骤未完成';
      },
      controller.signal,
    );
    if (token === serial) {
      await read();
      emit('updated');
    }
  } catch (e) {
    if (token === serial && !controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    if (token === serial) {
      busy.value = false;
      await read().catch(() => {});
    }
  }
}
async function start() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const token = serial;
  try {
    if (!sessionId.value) {
      const s = await api<Extract<AgentRecord, { kind: 'session' }>>('/agent/sessions', {
        context: props.context,
      });
      if (token !== serial) return;
      sessionId.value = s.id;
    }
    const w = await api('/agent/review/start', { sessionId: sessionId.value });
    if (token === serial) workflow.value = reviewWorkflowSchema.parse(w);
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  } finally {
    if (token === serial) busy.value = false;
  }
  if (token === serial) await generate();
}
async function respond() {
  if (!workflow.value || busy.value || !answer.value.trim()) return;
  const token = serial;
  busy.value = true;
  error.value = '';
  try {
    const w = await api('/agent/review/' + workflow.value.id + '/respond', {
      id: crypto.randomUUID(),
      version: workflow.value.version,
      text: answer.value,
    });
    if (token === serial) {
      workflow.value = reviewWorkflowSchema.parse(w);
      answer.value = '';
    }
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  } finally {
    if (token === serial) busy.value = false;
  }
  if (token === serial && !error.value) await generate();
}
async function cancel() {
  const token = serial;
  controller?.abort();
  if (!workflow.value) return;
  try {
    const next = reviewWorkflowSchema.parse(await api('/agent/review/' + workflow.value.id + '/cancel', {}));
    if (token !== serial) return;
    workflow.value = next;
    await read();
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  }
  if (token === serial) busy.value = false;
}
async function decide(id: string, approve: boolean) {
  if (busy.value) return;
  const token = serial;
  busy.value = true;
  error.value = '';
  try {
    await api('/agent/decision', { id, approve });
    if (token !== serial) return;
    await read();
    if (token === serial) emit('updated');
  } catch (e) {
    if (token === serial) error.value = (e as Error).message;
  } finally {
    if (token === serial) busy.value = false;
  }
}
watch(scope, load, { immediate: true });
onBeforeUnmount(() => {
  serial++;
  controller?.abort();
  if (busy.value && sessionId.value)
    void api('/agent/cancel', { sessionId: sessionId.value }).catch(() => {});
  emit('busy', false);
});
</script>
<template>
  <section class="guided-review learning-stack" aria-label="ReAct 引导复盘">
    <div class="section-head">
      <div>
        <span class="eyebrow">READ · ACT · CHECK</span>
        <h2>ReAct 引导复盘</h2>
        <p>读取记录，查证假设，一次解决一个问题。</p>
      </div>
      <button class="small-button" :disabled="busy" @click="emit('skip')">使用直接工具</button>
    </div>
    <p v-if="loading" role="status">正在恢复复盘进度…</p>
    <p v-if="error" class="alert error" role="alert">
      {{ error }} <RouterLink to="/settings?view=ai">检查模型配置</RouterLink>
    </p>
    <template v-if="workflow">
      <ol class="guided-stages">
        <li
          v-for="stage in reviewStages"
          :key="stage"
          :aria-current="workflow.stage === stage ? 'step' : undefined"
        >
          <span>{{ reviewStages.indexOf(stage) + 1 }}</span
          >{{ stageLabels[stage] }}
        </li>
      </ol>
      <p class="small subtle">
        {{
          context.kind === 'problem'
            ? '题目 ' + context.problemKey
            : context.kind === 'contest'
              ? context.source.toUpperCase() + ' · ' + context.contestId
              : ''
        }}
        · 已保存 {{ new Date(workflow.updatedAt).toLocaleString('zh-CN') }}
      </p>
      <p>{{ workflow.summary }}</p>
      <p v-if="busy" role="status">
        {{ events.at(-1)?.name ? '正在' + events.at(-1)?.name : '正在读取与整理' }}…
      </p>
      <button v-if="busy || workflow.status === 'running'" class="small-button" @click="cancel">
        停止引导
      </button>
      <button v-else-if="workflow.status === 'ready'" class="primary" @click="generate">继续当前步骤</button>
      <form
        v-else-if="['waiting', 'interrupted', 'cancelled'].includes(workflow.status)"
        class="guided-question"
        @submit.prevent="respond"
      >
        <h3>
          {{
            workflow.status === 'waiting' ? workflow.question : '本步已暂停，请补充信息或说明继续查证的方向。'
          }}
        </h3>
        <label
          >我的回答<textarea
            v-model="answer"
            required
            rows="4"
            maxlength="10000"
            placeholder="描述实际尝试、代码、最小反例或运行结果；不确定的地方可以直接说明。"
          /></label
        ><button class="primary" :disabled="busy || !answer.trim()">保存回答并继续</button>
      </form>
      <div v-else-if="workflow.status === 'completed'" class="alert">
        <strong>本次引导已结束</strong>
        <p>笔记保存、独立重做与迁移验证分别记录。完成引导不会自动提高掌握度。</p>
        <RouterLink to="/?view=path">查看学习路径与未来计划 →</RouterLink>
      </div>
      <details v-if="workflow.evidence.length">
        <summary>公开依据与待验证假设 · {{ workflow.evidence.length }} 条</summary>
        <article v-for="e in workflow.evidence" :key="e.id" class="guided-evidence">
          <span class="badge">{{
            e.status === 'observed' ? '工具记录' : e.status === 'hypothesis' ? '待验证假设' : '用户报告'
          }}</span
          ><strong>{{ e.label }}</strong>
          <p>{{ e.summary }}</p>
        </article>
      </details>
      <ProposalCard v-for="p in proposals" :key="p.id" :proposal="p" :busy="busy" @decide="decide" />
    </template>
    <template v-else-if="!loading"
      ><p>
        围绕当前题目或比赛依次确认情境、回忆过程、查证、验证、沉淀与迁移。需要已配置且支持工具调用的模型。
      </p>
      <button class="primary" :disabled="busy" @click="start">开始引导复盘</button></template
    >
  </section>
</template>
<style scoped>
.guided-review {
  padding: 24px;
}
.guided-review > .section-head > button {
  min-width: 96px;
}
.guided-stages {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.guided-stages li {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  padding: 12px;
  border-bottom: 2px solid var(--line);
}
.guided-stages li[aria-current] {
  color: var(--accent);
  border-color: var(--accent);
}
.guided-question {
  padding: 20px;
  border: 1px solid var(--line);
  background: var(--wash);
  border-radius: 12px;
}
.guided-question textarea {
  margin: 12px 0;
}
.guided-evidence {
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.guided-evidence strong {
  margin-left: 10px;
}
@media (max-width: 650px) {
  .guided-review {
    padding: 16px;
  }
  .guided-stages {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
