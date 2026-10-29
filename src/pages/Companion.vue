<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Send, Square, Plus, Sparkles, Trash2, ArrowUpRight } from 'lucide-vue-next';
import { api, settings, dataRevision, notify } from '../api';
import { useConfirm } from '../composables/useConfirm';
import { streamAgent } from '../agent';
import { growth } from '../growth';
import Companion from '../components/Companion.vue';
import Markdown from '../components/Markdown.vue';
import ProposalCard from '../components/agent/ProposalCard.vue';
import SessionList from '../components/agent/SessionList.vue';
import MemoryPanel from '../components/agent/MemoryPanel.vue';
import GuidedReview from '../components/review/GuidedReview.vue';
import type { AgentContext, AgentRecord, AgentEvent } from '../../shared/agent-domain';
const { confirmDialog } = useConfirm();
type Session = Extract<AgentRecord, { kind: 'session' }>;
type Memory = Extract<AgentRecord, { kind: 'memory' }>;
const route = useRoute();
const guided = ref(false),
  guidanceBusy = ref(false);
const sessions = ref<Session[]>([]),
  records = ref<AgentRecord[]>([]),
  memories = ref<Memory[]>([]),
  selected = ref('');
const preferences = ref({ memory: true, proactive: false }),
  input = ref(''),
  error = ref(''),
  loading = ref(true),
  busy = ref(false),
  draft = ref(''),
  activity = ref<AgentEvent[]>([]),
  panel = ref(false);
const memoryBusy = ref(false);
const log = ref<HTMLElement>(),
  composer = ref<HTMLTextAreaElement>();
let controller: AbortController | undefined;
let generation = 0;
const messages = computed(() =>
  records.value.filter((r): r is Extract<AgentRecord, { kind: 'message' }> => r.kind === 'message'),
);
const proposals = computed(() =>
  records.value.filter((r): r is Extract<AgentRecord, { kind: 'proposal' }> => r.kind === 'proposal'),
);
const current = computed(() => sessions.value.find((s) => s.id === selected.value));
function context(): AgentContext {
  if (typeof route.query.problemKey === 'string')
    return { kind: 'problem', problemKey: route.query.problemKey };
  if (
    typeof route.query.contestId === 'string' &&
    ['cf', 'atcoder', 'xcpc'].includes(String(route.query.source))
  )
    return {
      kind: 'contest',
      contestId: route.query.contestId,
      source: route.query.source as 'cf' | 'atcoder' | 'xcpc',
    };
  if (typeof route.query.month === 'string')
    return {
      kind: 'monthly',
      month: route.query.month,
      source: (route.query.source ?? 'all') as 'all' | 'cf' | 'atcoder',
    };
  return { kind: 'general' };
}
async function loadHistory() {
  if (!selected.value) {
    records.value = [];
    return;
  }
  const id = selected.value;
  const value = await api<AgentRecord[]>('/agent/history?sessionId=' + encodeURIComponent(id));
  if (id === selected.value) records.value = value;
}
async function load() {
  const g = ++generation;
  loading.value = true;
  error.value = '';
  try {
    const [list, memory, prefs] = await Promise.all([
      api<Session[]>('/agent/sessions'),
      api<Memory[]>('/agent/memories'),
      api<{ memory: boolean; proactive: boolean }>('/agent/settings'),
    ]);
    if (g !== generation) return;
    sessions.value = list;
    memories.value = memory;
    preferences.value = prefs;
    if (!list.some((s) => s.id === selected.value)) selected.value = list.at(-1)?.id ?? '';
    const ctx = context();
    if (ctx.kind !== 'general' && !list.some((s) => JSON.stringify(s.context) === JSON.stringify(ctx)))
      await create();
    else if (ctx.kind !== 'general')
      selected.value = list.find((s) => JSON.stringify(s.context) === JSON.stringify(ctx))!.id;
    await loadHistory();
  } catch (e) {
    if (g === generation) error.value = (e as Error).message;
  } finally {
    if (g === generation) loading.value = false;
  }
}
async function create() {
  if (busy.value || guidanceBusy.value) return;
  error.value = '';
  try {
    const s = await api<Session>('/agent/sessions', { context: context() });
    sessions.value.push(s);
    selected.value = s.id;
    records.value = [];
    draft.value = '';
    activity.value = [];
    await nextTick();
    composer.value?.focus();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function choose(id: string) {
  if (busy.value || guidanceBusy.value) return;
  selected.value = id;
  draft.value = '';
  activity.value = [];
  error.value = '';
  try {
    await loadHistory();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function send() {
  if (busy.value || !input.value.trim()) return;
  if (!selected.value) await create();
  if (!selected.value) return;
  const text = input.value.trim();
  input.value = '';
  error.value = '';
  busy.value = true;
  draft.value = '';
  activity.value = [];
  controller = new AbortController();
  const g = generation;
  records.value.push({
    kind: 'message',
    id: crypto.randomUUID(),
    sessionId: selected.value,
    role: 'user',
    content: text,
    citations: [],
    createdAt: new Date().toISOString(),
  });
  try {
    await streamAgent(
      { sessionId: selected.value, requestId: crypto.randomUUID(), message: text },
      (e) => {
        if (g !== generation) return;
        if (e.type === 'text') draft.value += e.text ?? '';
        else if (e.type === 'error') error.value = e.text ?? '生成失败';
        else activity.value.push(e);
        void nextTick().then(() => {
          if (log.value && log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 240)
            log.value.scrollTop = log.value.scrollHeight;
        });
      },
      controller.signal,
    );
  } catch (e) {
    if (g === generation && !controller.signal.aborted) error.value = (e as Error).message;
  } finally {
    if (g === generation) {
      busy.value = false;
      await loadHistory().catch(() => {});
      draft.value = '';
      memories.value = await api<Memory[]>('/agent/memories').catch(() => memories.value);
      dataRevision.value++;
    }
  }
}
async function stop() {
  controller?.abort();
  try {
    await api('/agent/cancel', { sessionId: selected.value });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
function retry() {
  const last = messages.value.findLast((m) => m.role === 'user');
  if (last) {
    input.value = last.content;
    void send();
  }
}
async function decide(id: string, approve: boolean) {
  error.value = '';
  try {
    await api('/agent/decision', { id, approve });
    dataRevision.value++;
    await loadHistory();
  } catch (e) {
    error.value = (e as Error).message;
    await loadHistory().catch(() => {});
  }
}
async function savePreferences() {
  try {
    await api('/agent/settings', preferences.value, 'PUT');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function saveMemory(m: Memory) {
  memoryBusy.value = true;
  try {
    await api('/agent/memory', { id: m.id, content: m.content }, 'PUT');
    notify('星澪记忆已保存');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    memoryBusy.value = false;
  }
}
async function removeMemory(id: string) {
  try {
    await api('/agent/memory', { id }, 'DELETE');
    memories.value = memories.value.filter((m) => m.id !== id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function removeSession() {
  if (busy.value || guidanceBusy.value || !selected.value) return;
  if (!(await confirmDialog('删除此会话及其消息？已保存的学习记录和长期记忆会保留。'))) return;
  try {
    await api('/agent/session', { id: selected.value }, 'DELETE');
    selected.value = '';
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => [settings.value.activeHandle, settings.value.activeAtcoder, settings.value.xcpcPlayer?.key],
  () => {
    generation++;
    controller?.abort();
    busy.value = false;
    records.value = [];
    sessions.value = [];
    memories.value = [];
    selected.value = '';
    void load();
  },
);
watch(
  () => route.fullPath,
  () => {
    if (!busy.value) void load();
  },
);
onMounted(load);
onBeforeUnmount(() => {
  generation++;
  controller?.abort();
  if (busy.value && selected.value) void api('/agent/cancel', { sessionId: selected.value }).catch(() => {});
});
</script>
<template>
  <div class="page-heading">
    <div>
      <span class="terminal-tag">ASTRA / PERSONAL LEARNING AGENT</span>
      <h1>与星澪同行</h1>
      <p class="subtle">把困惑说出来，一起找到下一步。</p>
    </div>
    <button class="button" @click="panel = !panel" :aria-expanded="panel">记忆与偏好</button>
  </div>
  <div v-if="error" class="alert error" role="alert">
    {{ error }}
    <RouterLink v-if="!settings.activeHandle && !settings.activeAtcoder" to="/settings"
      >绑定学习账号</RouterLink
    ><button v-else-if="messages.length && !busy" class="button small" @click="retry">重试上条消息</button
    ><button v-else-if="!busy" class="button small" @click="load">重新加载</button>
  </div>
  <p v-if="loading" role="status">正在连接学习终端…</p>
  <div v-else class="astra-layout">
    <aside class="astra-sessions card">
      <div class="astra-profile">
        <Companion :appearance="growth?.equipment.appearance" />
        <div><strong>星澪 / ASTRA</strong><span class="subtle small">温柔理性的学习搭档</span></div>
      </div>
      <button class="button primary" :disabled="busy || guidanceBusy" @click="create">
        <Plus :size="16" /> 新建会话
      </button>
      <SessionList :sessions="sessions" :selected="selected" :busy="busy || guidanceBusy" @select="choose" />
      <button
        v-if="selected"
        class="button ghost small"
        :disabled="busy || guidanceBusy"
        @click="removeSession"
      >
        <Trash2 :size="14" /> 删除当前会话
      </button>
      <RouterLink class="subtle small" to="/settings?view=ai"
        >模型设置与能力测试 <ArrowUpRight :size="12"
      /></RouterLink>
    </aside>
    <section class="astra-dialog card" aria-label="星澪对话">
      <header class="astra-dialog-header">
        <Sparkles :size="18" /><strong>星澪已就位</strong
        ><span class="terminal-tag">{{
          current?.context.kind === 'problem'
            ? '题目陪练'
            : current?.context.kind === 'contest'
              ? '比赛教练'
              : '学习伙伴'
        }}</span>
      </header>
      <div v-if="current && ['problem', 'contest'].includes(current.context.kind)" class="button-row">
        <button class="small-button" :disabled="busy || guidanceBusy" @click="guided = !guided">
          {{ guided ? '返回直接对话' : '切换到引导复盘' }}</button
        ><span class="small subtle">{{
          current.context.kind === 'problem'
            ? current.context.problemKey
            : current.context.kind === 'contest'
              ? current.context.source.toUpperCase() + ' · ' + current.context.contestId
              : ''
        }}</span>
      </div>
      <GuidedReview
        v-if="guided && current"
        :context="current.context"
        :session-id="current.id"
        @skip="guided = false"
        @busy="guidanceBusy = $event"
        @updated="loadHistory"
      />
      <template v-if="!guided">
        <div ref="log" class="astra-log" tabindex="0" aria-label="对话消息">
          <div v-if="!messages.length && !busy" class="astra-welcome">
            <span class="terminal-tag">READY WHEN YOU ARE</span>
            <h2>未知，也可以成为起点。</h2>
            <p>我可以陪你梳理思路、检索知识、复盘比赛。学习状态来自真实记录，重要修改会先展示给你。</p>
            <div class="astra-prompts">
              <button class="button" @click="input = '结合最近的学习证据，我接下来应该关注什么？'">
                看看下一步</button
              ><button class="button" @click="input = '请记住：我更喜欢先讲直觉，再讲证明。'">
                告诉我你的偏好
              </button>
            </div>
          </div>
          <article v-for="m in messages" :key="m.id" class="astra-message" :class="m.role">
            <span class="terminal-tag">{{ m.role === 'user' ? '你' : '星澪 / ASTRA' }}</span
            ><Markdown :text="m.content" />
            <details v-if="m.citations.length">
              <summary>本轮检索依据</summary>
              <div v-for="c in m.citations" :key="c.id">
                <RouterLink v-if="c.url.startsWith('/')" :to="c.url">{{ c.title }}</RouterLink
                ><a v-else :href="c.url" target="_blank" rel="noopener noreferrer">{{ c.title }}</a>
                <p class="subtle small">{{ c.excerpt }}</p>
              </div>
            </details>
          </article>
          <article v-if="draft" class="astra-message assistant">
            <span class="terminal-tag">星澪 / ASTRA</span><Markdown :text="draft" />
          </article>
          <div v-if="busy" class="astra-working" role="status">
            {{
              activity.at(-1)?.type === 'tool-start' ? '正在' + activity.at(-1)?.name + '…' : '正在整理回答…'
            }}
          </div>
        </div>
        <details v-if="activity.some((a) => a.type === 'tool-end')" class="astra-task-log">
          <summary>本轮执行摘要</summary>
          <p v-for="(a, i) in activity.filter((a) => a.type === 'tool-end')" :key="i">
            {{ a.name }} · {{ a.text }}
          </p>
        </details>
        <ProposalCard v-for="p in proposals" :key="p.id" :proposal="p" :busy="busy" @decide="decide" />
        <form class="astra-composer" @submit.prevent="send">
          <label class="sr-only" for="astra-input">发送给星澪的消息</label
          ><textarea
            id="astra-input"
            ref="composer"
            v-model="input"
            rows="3"
            maxlength="10000"
            placeholder="说说你卡住的地方，或今天想达成的目标…"
            @keydown.ctrl.enter.prevent="send"
            @keydown.meta.enter.prevent="send"
          ></textarea>
          <div>
            <span class="subtle small">Ctrl / ⌘ + Enter 发送 · 解题帮助会计入提示记录</span
            ><button v-if="busy" type="button" class="button" @click="stop">
              <Square :size="14" /> 停止生成</button
            ><button v-else class="button primary" :disabled="!input.trim()"><Send :size="15" /> 发送</button>
          </div>
        </form>
      </template>
    </section>
    <MemoryPanel
      v-model="panel"
      v-model:memories="memories"
      v-model:preferences="preferences"
      :busy="memoryBusy || busy || guidanceBusy"
      @save="saveMemory"
      @remove="removeMemory"
      @settings="savePreferences"
    />
  </div>
</template>
