<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Send, Square, Plus, Sparkles, Trash2, ArrowUpRight } from 'lucide-vue-next';
import { api, settings, dataRevision, notify } from '../api';
import { streamAgent } from '../agent';
import { growth } from '../growth';
import Companion from '../components/Companion.vue';
import Markdown from '../components/Markdown.vue';
import type { AgentContext, AgentRecord, AgentEvent } from '../../shared/agent-domain';
type Session = Extract<AgentRecord, { kind: 'session' }>;
type Memory = Extract<AgentRecord, { kind: 'memory' }>;
const route = useRoute();
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
const labels: Record<string, string> = {
  review: '保存复盘笔记',
  card: '修改或确认经验卡',
  delete: '删除学习记录',
  weekly: '更新本周目标',
  transfer: '安排迁移任务',
  agent: '调整未来题单',
};
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
  if (busy.value) return;
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
  if (busy.value) return;
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
  if (busy.value || !selected.value) return;
  if (!window.confirm('删除此会话及其消息？已保存的学习记录和长期记忆会保留。')) return;
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
      <button class="button primary" :disabled="busy" @click="create"><Plus :size="16" /> 新建会话</button>
      <div class="astra-session-list" aria-label="会话列表">
        <button
          v-for="s in sessions.slice().reverse()"
          :key="s.id"
          class="button"
          :class="{ active: selected === s.id }"
          :disabled="busy"
          @click="choose(s.id)"
        >
          {{
            s.context.kind === 'problem'
              ? s.context.problemKey
              : s.context.kind === 'contest'
                ? s.context.contestId
                : s.title
          }}<small>{{ new Date(s.createdAt).toLocaleDateString('zh-CN') }}</small>
        </button>
      </div>
      <button v-if="selected" class="button ghost small" :disabled="busy" @click="removeSession">
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
      <div v-for="p in proposals" :key="p.id" class="astra-proposal">
        <span class="terminal-tag"
          >{{ labels[p.action] }} /
          {{
            p.status === 'pending'
              ? '待确认'
              : p.status === 'applied'
                ? '已执行'
                : p.status === 'expired'
                  ? '已失效'
                  : '已拒绝'
          }}</span
        >
        <pre>{{ p.preview }}</pre>
        <div v-if="p.status === 'pending'">
          <button class="button primary" :disabled="busy" @click="decide(p.id, true)">确认执行</button
          ><button class="button" :disabled="busy" @click="decide(p.id, false)">拒绝</button>
        </div>
        <details v-if="p.result">
          <summary>执行结果</summary>
          <pre>{{ p.result }}</pre>
        </details>
      </div>
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
    </section>
    <aside v-if="panel" class="astra-memory card">
      <h2>记忆与偏好</h2>
      <p class="subtle small">只记住你明确表达的目标与习惯。成绩和掌握度每次从真实记录读取。</p>
      <label
        ><input v-model="preferences.memory" type="checkbox" @change="savePreferences" /> 使用长期记忆</label
      ><label
        ><input v-model="preferences.proactive" type="checkbox" @change="savePreferences" />
        开启站内主动建议</label
      >
      <p class="subtle small">主动建议每天最多两次，仅在应用打开时运行。</p>
      <div v-for="m in memories" :key="m.id" class="astra-memory-item">
        <label :for="'memory-' + m.id">已记住的偏好</label
        ><textarea :id="'memory-' + m.id" v-model="m.content" rows="3" maxlength="2000"></textarea>
        <div>
          <button class="button small" :disabled="memoryBusy || busy" @click="saveMemory(m)">保存记忆</button
          ><button class="button small" @click="removeMemory(m.id)">删除记忆</button>
        </div>
      </div>
      <p v-if="!memories.length" class="subtle">还没有长期记忆。可以说“请记住：……”告诉我。</p>
    </aside>
  </div>
</template>
