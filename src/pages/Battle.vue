<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, settings } from '../api';
import { knowledgeCards } from '../../shared/knowledge';
import type { BattleRecord, BattleState } from '../../shared/battle-service';

const route = useRoute();
const state = ref<BattleState>();
const skillId = ref(
  knowledgeCards.some((c) => c.id === route.query.skill) ? String(route.query.skill) : 'simulation',
);
const theme = ref('');
const error = ref(''),
  notice = ref(''),
  busy = ref(false),
  minimum = ref(1000),
  maximum = ref(1300);
const records = ref<BattleRecord[]>(),
  recordsError = ref(''),
  recordsBusy = ref(false);
const session = computed(() => state.value?.session);
const current = computed(() => session.value?.items.find((i) => i.outcome === 'current'));
const pending = computed(
  () => session.value?.items.filter((i) => i.outcome === 'accepted' && !i.evaluation) ?? [],
);
const history = computed(() =>
  [...(session.value?.items ?? [])].filter((i) => i.outcome !== 'current').reverse(),
);
const historyCount = ref(10);
const title = (id: string) => knowledgeCards.find((c) => c.id === id)?.title ?? id;
const label = (value: string | null) =>
  ({
    independent: '独立完成',
    hint: '借助提示',
    failed: '未完成',
    skipped: '已跳过',
    accepted: '已 AC · 待评价',
    current: '进行中',
  })[value ?? 'accepted'];
const themeOf = (s: { skillId: string; custom?: { theme: string } | null }) =>
  s.custom?.theme || title(s.skillId);
const recordStatus = (status: string) =>
  ({ active: '进行中', paused: '已中断', ended: '已结束' })[status] ?? status;
const summaryBusy = ref('');
let alive = true,
  generation = 0,
  timer: ReturnType<typeof setInterval> | undefined;
async function load(id?: string) {
  const token = ++generation,
    handle = settings.value.activeHandle;
  try {
    const next = await api<BattleState>('/training/battle' + (id ? '/' + id : ''));
    if (!alive || generation !== token || settings.value.activeHandle !== handle) return;
    state.value = next;
    if (next.session) {
      minimum.value = next.session.minimum;
      maximum.value = next.session.maximum;
    }
  } catch (e) {
    if (alive && generation === token) error.value = (e as Error).message;
  }
}
async function loadRecords() {
  recordsBusy.value = true;
  recordsError.value = '';
  try {
    records.value = await api<BattleRecord[]>('/training/battle/records');
  } catch (e) {
    if (alive) recordsError.value = (e as Error).message;
  } finally {
    recordsBusy.value = false;
  }
}
async function start() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const handle = settings.value.activeHandle,
    token = ++generation;
  const body = theme.value.trim()
    ? { handle, theme: theme.value.trim(), operationId: crypto.randomUUID() }
    : { handle, skillId: skillId.value, operationId: crypto.randomUUID() };
  try {
    const next = await api<BattleState>('/training/battle', body);
    if (alive && token === generation && handle === settings.value.activeHandle) {
      state.value = next;
      minimum.value = next.session!.minimum;
      maximum.value = next.session!.maximum;
      notice.value = theme.value.trim() ? '已按主题完成选题，开始连战。' : '';
      theme.value = '';
    }
  } catch (e) {
    if (alive && token === generation) error.value = (e as Error).message;
  } finally {
    if (token === generation) busy.value = false;
  }
}
async function summarize(id: string) {
  summaryBusy.value = id;
  try {
    await api('/training/battle/' + id + '/summarize', {
      handle: settings.value.activeHandle,
      operationId: crypto.randomUUID(),
    });
    notice.value = '连战总结已生成，可在下方战报中查看。';
  } catch (e) {
    if (alive) recordsError.value = (e as Error).message;
  } finally {
    summaryBusy.value = '';
    await loadRecords();
  }
}
/** 结束本轮并自动生成 AI 总结；被中断的场次也可从战报中一键补结。 */
async function endAndSummarize(id?: string) {
  if (id && id !== session.value?.id) {
    recordsBusy.value = true;
    try {
      const record = records.value?.find((r) => r.id === id);
      await api('/training/battle/' + id, {
        handle: settings.value.activeHandle,
        revision: record?.revision ?? 0,
        operationId: crypto.randomUUID(),
        action: 'end',
      });
    } catch (e) {
      recordsError.value = (e as Error).message;
      recordsBusy.value = false;
      return;
    }
    recordsBusy.value = false;
  } else {
    await act('end');
    if (error.value) return;
    id = session.value!.id;
  }
  await summarize(id);
  await load();
}
async function act(action: string, extra: Record<string, unknown> = {}, silent = false) {
  const s = session.value;
  if (!s || busy.value) return;
  busy.value = true;
  error.value = '';
  if (!silent) notice.value = '';
  const token = ++generation,
    handle = settings.value.activeHandle;
  const previous = current.value?.id;
  try {
    const next = await api<BattleState>('/training/battle/' + s.id, {
      handle,
      revision: s.revision,
      operationId: crypto.randomUUID(),
      action,
      ...extra,
    });
    if (!alive || token !== generation || handle !== settings.value.activeHandle) return;
    state.value = next;
    if (
      action === 'sync' &&
      previous &&
      next.session?.items.find((i) => i.outcome === 'current')?.id !== previous
    )
      notice.value = '已检测到 AC，下一题已就绪。上一题的独立评价可在下方补充。';
    else if (action === 'refresh') notice.value = '题库已检查，点击继续连战重新选题。';
    else if (action === 'evaluate') notice.value = '评价已保存，掌握度与连续奖励已重新计算。';
    else if (action === 'sync' && !silent) notice.value = '已检查提交，暂未检测到新的个人 AC。';
  } catch (e) {
    if (alive && token === generation) {
      error.value = (e as Error).message;
      // A competing tab may have advanced the session; read back without repeating the action.
      if (error.value.includes('进度已变化')) {
        busy.value = false;
        await load(s.id);
      }
    }
  } finally {
    if (token === generation) busy.value = false;
  }
}
function check() {
  if (document.visibilityState === 'visible' && session.value?.status === 'active')
    void act('sync', {}, true);
}
watch(
  () => settings.value.activeHandle,
  () => {
    generation++;
    state.value = undefined;
    busy.value = false;
    error.value = '';
    notice.value = '';
    void load();
    void loadRecords();
  },
);
onMounted(async () => {
  await load();
  check();
  timer = setInterval(check, 30000);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  void loadRecords();
});
onBeforeUnmount(() => {
  alive = false;
  generation++;
  clearInterval(timer);
  document.removeEventListener('visibilitychange', check);
  window.removeEventListener('focus', check);
});
</script>

<template>
  <div class="page-head">
    <div>
      <span class="eyebrow">FOCUSED PRACTICE</span>
      <h1>知识点连战</h1>
      <p>一个知识点，一题接一题。AC 后自动换题，独立完成获得连战加成。</p>
    </div>
    <RouterLink to="/" class="text-link">返回今日训练 →</RouterLink>
  </div>
  <p v-if="error" role="alert" class="alert error">
    {{ error }}
    <button class="small-button" :disabled="busy" @click="session ? act('sync') : load()">重试</button>
  </p>
  <p v-if="notice" role="status" class="battle-notice">{{ notice }}</p>
  <section v-if="!settings.activeHandle" class="panel battle-panel">
    <h2>先连接 Codeforces</h2>
    <p>连战使用真实题库与个人提交记录。</p>
    <RouterLink to="/settings?view=accounts">绑定账号 →</RouterLink>
  </section>
  <template v-else>
    <section v-if="!session || session.status === 'ended'" class="panel battle-panel battle-start">
      <div>
        <h2>选择这次要练的内容</h2>
        <p class="subtle">按你的当前难度推荐，优先未做过的题目。也可以输入任意主题，由 AI 映射到题库标签。</p>
      </div>
      <label
        >连战知识点<select v-model="skillId">
          <option v-for="card in knowledgeCards" :key="card.id" :value="card.id">{{ card.title }}</option>
        </select></label
      >
      <label
        >或输入自定义主题<input
          v-model="theme"
          maxlength="60"
          placeholder="例如：线段树、期望 DP、二分答案"
          :disabled="busy"
      /></label>
      <button :disabled="busy || !!state?.activeId" @click="start">
        {{ busy && theme.trim() ? '正在解析主题…' : '开始连战' }}
      </button>
      <button v-if="state?.activeId" class="small-button" @click="load(state.activeId)">
        返回进行中的连战
      </button>
    </section>
    <template v-if="session">
      <section class="panel battle-panel battle-current" aria-labelledby="battle-title">
        <div class="battle-heading">
          <div>
            <span class="eyebrow"
              >{{ themeOf(session) }} · {{ session.minimum }}–{{ session.maximum
              }}<template v-if="session.custom">
                · 主题连战（知识点：{{ title(session.skillId) }}）</template
              ></span
            >
            <h2 id="battle-title">
              {{
                session.status === 'ended'
                  ? '这轮连战已结束'
                  : session.status === 'paused'
                    ? '连战已暂停'
                    : '当前挑战'
              }}
            </h2>
          </div>
          <span class="badge"
            >{{ session.items.filter((i) => i.outcome === 'accepted').length }} 题 AC · 连续独立
            {{ state?.streak ?? 0 }} 题</span
          >
        </div>
        <template v-if="current && session.status !== 'ended'">
          <h3 class="battle-problem-title">{{ current.problem.name }}</h3>
          <p class="subtle">
            {{ current.problem.key.replace(':', '') }} · 难度 {{ current.problem.rating }} · 匹配标签：{{
              current.problem.tags
                .filter((t) =>
                  (session!.custom?.tags ??
                    knowledgeCards.find((c) => c.id === session!.skillId)!.tags).includes(t),
                )
                .join(' / ')
            }}
          </p>
          <div class="battle-actions">
            <a :href="current.problem.url" target="_blank" rel="noreferrer" class="button">打开原题 ↗</a
            ><button
              v-if="session.status === 'active'"
              class="small-button"
              :disabled="busy"
              @click="act('sync')"
            >
              {{ busy ? '处理中…' : '检查 AC / 下一题' }}
            </button>
          </div>
        </template>
        <p v-if="session.exhausted" class="battle-empty">
          当前难度范围内没有新的匹配题目。可以刷新题库、调整难度后继续，或结束本轮并更换知识点。
        </p>
        <p class="battle-reward">
          {{
            state?.pending
              ? `${state.pending} 题待评价，连续加成待结算`
              : `下一次独立完成：${(1 + Math.min((state?.streak ?? 0) + 1, 5) / 10).toFixed(1)}× 加成`
          }}<small>独立评价后更新统计掌握度与知识掌握概率</small>
        </p>
        <div v-if="session.status !== 'ended'" class="battle-actions">
          <button
            v-if="session.status === 'active'"
            class="small-button"
            :disabled="busy"
            @click="act('pause')"
          >
            暂停
          </button>
          <button v-else :disabled="busy" @click="act('resume')">继续连战</button>
          <button
            v-if="current && session.status === 'active'"
            class="small-button"
            :disabled="busy"
            @click="act('skip')"
          >
            跳过此题
          </button>
          <button
            v-if="current && session.status === 'active'"
            class="small-button"
            :disabled="busy"
            @click="act('fail')"
          >
            记录未完成
          </button>
          <button
            class="small-button"
            :disabled="busy || summaryBusy === session.id"
            @click="endAndSummarize()"
          >
            {{ summaryBusy === session.id ? '正在生成总结…' : '结束本轮并生成总结' }}
          </button>
        </div>
      </section>
      <section v-if="pending.length" class="panel battle-panel battle-evaluation" aria-label="补充独立评价">
        <div class="battle-heading">
          <h2>上一题做得怎样？</h2>
          <span class="badge">{{ pending.length }} 题待评价</span>
        </div>
        <p>{{ pending[0].problem.name }}</p>
        <div class="battle-actions">
          <button :disabled="busy" @click="act('evaluate', { itemId: pending[0].id, result: 'independent' })">
            独立完成</button
          ><button
            class="small-button"
            :disabled="busy"
            @click="act('evaluate', { itemId: pending[0].id, result: 'hint' })"
          >
            借助提示
          </button>
        </div>
        <p class="small subtle">评价不影响继续做题；使用提示会重置连续独立完成次数。</p>
      </section>
      <details class="panel battle-panel">
        <summary>本轮记录与评价修正 · {{ history.length }} 题</summary>
        <ol class="battle-history">
          <li v-for="item in history.slice(0, historyCount)" :key="item.id">
            <div>
              <strong>{{ item.problem.name }}</strong>
              <p class="small subtle">
                {{ label(item.evaluation ?? item.outcome) }}
                <span v-if="state?.rewards.find((r) => r.itemId === item.id)?.result === 'independent'"
                  >· {{ state.rewards.find((r) => r.itemId === item.id)?.multiplier.toFixed(1) }}×</span
                >
              </p>
            </div>
            <label v-if="item.outcome === 'accepted'"
              >评价<select
                :value="item.evaluation ?? ''"
                :disabled="busy"
                @change="
                  act('evaluate', { itemId: item.id, result: ($event.target as HTMLSelectElement).value })
                "
              >
                <option disabled value="">待评价</option>
                <option value="independent">独立完成</option>
                <option value="hint">借助提示</option>
                <option value="failed">未独立完成</option>
              </select></label
            >
          </li>
        </ol>
        <button v-if="history.length > historyCount" class="small-button" @click="historyCount += 10">
          再显示 10 题
        </button>
      </details>
      <details v-if="session.status !== 'ended'" class="panel battle-panel">
        <summary>题库与难度</summary>
        <p class="subtle small">调整只影响下一次选题，当前题会保留。</p>
        <div class="battle-actions">
          <label
            >最低难度<input v-model.number="minimum" type="number" min="800" max="4000" step="100" /></label
          ><label
            >最高难度<input v-model.number="maximum" type="number" min="800" max="4000" step="100" /></label
          ><button class="small-button" :disabled="busy" @click="act('difficulty', { minimum, maximum })">
            保存难度</button
          ><button class="small-button" :disabled="busy" @click="act('refresh')">刷新题库</button>
        </div>
      </details>
    </template>
    <section class="panel battle-panel battle-archive" aria-label="连战战报">
      <div class="battle-heading">
        <h2>连战战报</h2>
        <button class="small-button" :disabled="recordsBusy" @click="loadRecords">
          {{ recordsBusy ? '刷新中…' : '刷新战报' }}
        </button>
      </div>
      <p class="small subtle">
        每轮连战（含被中断的场次）都会自动归入战报：主题、耗时与题目数量一目了然；结束的场次自动生成 AI 总结。
        连续独立完成的加成从 1.1× 递增至 1.5×，跳过、记录失败或使用提示会重置；奖励计入统计掌握度与知识掌握概率。
      </p>
      <p v-if="recordsError" role="alert" class="alert error">{{ recordsError }}</p>
      <p v-else-if="!records?.length" class="quiet-empty">
        还没有连战记录：选一个知识点或输入主题开始第一轮。
      </p>
      <ol v-else class="battle-records">
        <li v-for="r in records" :key="r.id">
          <div class="battle-record-head">
            <strong>{{ r.theme }}</strong>
            <span class="badge" :data-status="r.status">{{ recordStatus(r.status) }}</span>
          </div>
          <p class="small subtle">
            {{ new Date(r.createdAt).toLocaleString() }} · 耗时 {{ r.durationMinutes }} 分钟 ·
            {{ r.problemCount }} 题 / AC {{ r.solvedCount }}
            <template v-if="r.pendingCount"> · {{ r.pendingCount }} 题待评价</template>
          </p>
          <details v-if="r.summary" class="battle-summary">
            <summary>AI 总结</summary>
            <p>{{ r.summary.text }}</p>
            <ul v-if="r.summary.highlights.length">
              <li v-for="h in r.summary.highlights" :key="h">{{ h }}</li>
            </ul>
            <ul v-if="r.summary.advice.length" class="battle-advice">
              <li v-for="a in r.summary.advice" :key="a">{{ a }}</li>
            </ul>
            <button
              class="small-button"
              :disabled="summaryBusy === r.id"
              @click="summarize(r.id)"
            >
              {{ summaryBusy === r.id ? '重新生成中…' : '重新生成总结' }}
            </button>
          </details>
          <p v-else-if="r.status !== 'active'" class="small subtle">尚未生成 AI 总结。</p>
          <div class="battle-actions">
            <button v-if="r.id !== session?.id" class="small-button" @click="load(r.id)">
              查看详情
            </button>
            <button
              v-if="r.status === 'paused' && r.id !== session?.id"
              class="small-button"
              :disabled="recordsBusy || summaryBusy === r.id"
              @click="endAndSummarize(r.id)"
            >
              {{ summaryBusy === r.id ? '正在生成总结…' : '结束并生成总结' }}
            </button>
            <button
              v-if="!r.summary && r.status === 'ended' && r.id !== session?.id"
              class="small-button"
              :disabled="summaryBusy === r.id"
              @click="summarize(r.id)"
            >
              {{ summaryBusy === r.id ? '生成中…' : '生成总结' }}
            </button>
          </div>
        </li>
      </ol>
    </section>
  </template>
</template>

<style scoped>
.battle-panel {
  padding: 18px;
  margin-bottom: 12px;
  min-width: 0;
}
.battle-heading,
.battle-actions,
.battle-start {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.battle-heading {
  justify-content: space-between;
}
.battle-panel h2 {
  font-size: 18px;
  margin: 4px 0;
}
.battle-start > div {
  flex: 1 1 240px;
}
.battle-panel label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.battle-panel input {
  width: 100px;
}
.battle-panel select {
  max-width: 100%;
  min-width: 0;
}
.battle-current {
  border-top: 3px solid var(--accent);
}
.battle-problem-title {
  font-size: clamp(21px, 3vw, 30px);
  margin: 18px 0 8px;
  overflow-wrap: anywhere;
}
.battle-reward {
  color: var(--accent);
  font-weight: 650;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  margin: 16px 0 0;
}
.battle-reward small {
  display: block;
  color: var(--muted);
  font-weight: 400;
  margin-top: 4px;
}
.battle-notice {
  font-size: 13px;
  color: var(--accent);
}
.battle-empty {
  padding: 12px 0;
  line-height: 1.7;
}
.battle-history {
  list-style: none;
  padding: 0;
  margin-bottom: 0;
}
.battle-records {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
}
.battle-records li {
  padding: 14px 0;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 8px;
}
.battle-record-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.battle-records .battle-actions {
  gap: 8px;
}
.battle-summary {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 14px;
}
.battle-summary summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--accent);
}
.battle-summary p {
  margin: 10px 0;
  line-height: 1.7;
}
.battle-summary ul {
  margin: 6px 0;
  padding-left: 18px;
}
.battle-advice {
  color: var(--muted);
}
.battle-history li {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.battle-history li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.battle-panel summary {
  cursor: pointer;
  font-size: 13px;
}
@media (max-width: 650px) {
  .battle-panel {
    padding: 14px;
  }
  .battle-heading {
    gap: 6px;
  }
  .battle-actions {
    gap: 8px;
  }
  .battle-history li {
    align-items: start;
  }
  .battle-history select {
    width: 110px;
  }
}
</style>
