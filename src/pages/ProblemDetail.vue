<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router';
import {
  ArrowLeft,
  ExternalLink,
  Save,
  RotateCcw,
  Eye,
  EyeOff,
  Clock3,
  Sparkles,
  Trash2,
} from 'lucide-vue-next';
import { api, notify, statusLabels, resultLabels, fullDate, localDate } from '../api';
import {
  reasonOptions,
  verdictLabel,
  emptyReview,
  type ProblemRow,
  type CFSubmission,
  type Attempt,
  type Review,
} from '../../shared/domain';
import type { AiReviewRecord } from '../../shared/ai-review';
import Markdown from '../components/Markdown.vue';
import { useSection } from '../sections';
import LearningProblem from '../components/LearningProblem.vue';
import { categoryNames } from '../../shared/training';
import { reviewQualityHints } from '../../shared/training-extras';
const route = useRoute(),
  key = String(route.params.key);
const tab = useSection(['notes', 'submissions', 'attempts', 'assistant'] as const, 'notes');
const tool = useSection(['code', 'hints', 'stress', 'experience', 'transfer'] as const, 'code', 'tool');
const showSharedCode = ref(false);
const evaluationCard = ref<HTMLElement | null>(null);
function focusEvaluation() {
  evaluationCard.value?.scrollIntoView({ block: 'start', behavior: 'auto' });
  const heading = evaluationCard.value?.querySelector<HTMLElement>('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}
const learningOpened = ref(tab.value === 'assistant' && tool.value !== 'code');
watch([tab, tool], () => {
  if (tab.value === 'assistant' && tool.value !== 'code') learningOpened.value = true;
});
const data = ref<{ problem: ProblemRow; submissions: CFSubmission[]; attempts: Attempt[] } | null>(null),
  draft = ref<Review>(emptyReview()),
  snapshot = ref(''),
  preview = ref(false),
  error = ref(''),
  busy = ref(false),
  customReason = ref('');
const attempt = ref<{ result: 'independent' | 'hint' | 'failed'; minutes: number; note: string }>({
  result: 'independent',
  minutes: 0,
  note: '',
});
const aiReviews = ref<AiReviewRecord[]>([]),
  aiConfigured = ref(false),
  aiBusy = ref(false),
  aiError = ref(''),
  aiExpanded = ref<string | null>(null),
  fetchingSubmission = ref(0),
  selectedSubmission = ref('');
const aiForm = ref({ code: '', language: 'cpp', verdict: '', focus: '', statement: '' });
const aiVerdictOptions = [
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'OK',
];
const fields = [
  { key: 'wrongIdea', label: '当时的思路', hint: '当时怎么想的？卡在了哪里？' },
  { key: 'rootCause', label: '根本原因', hint: '为什么会错？是知识缺口，还是实现偏差？' },
  {
    key: 'solution',
    label: '正确解法',
    hint: '描述关键观察、算法步骤与正确性。支持 $行内公式$ 和 $$ 独立公式。',
  },
  { key: 'complexity', label: '复杂度分析', hint: '时间复杂度与空间复杂度' },
  { key: 'counterexample', label: '关键反例与边界', hint: '留下一个最小反例，提醒未来的自己。' },
] as const;
const dirty = computed(() => Boolean(data.value) && JSON.stringify(draft.value) !== snapshot.value);
const qualityHints = computed(() => reviewQualityHints(draft.value));
const nextDate = computed({
  get: () => (draft.value.nextReview ? localDate(draft.value.nextReview) : ''),
  set: (v) => (draft.value.nextReview = v ? new Date(v + 'T09:00:00').toISOString() : null),
});
let inFlightSave: Promise<void> | null = null;
async function load() {
  try {
    data.value = await api('/problems/' + encodeURIComponent(key));
    draft.value = JSON.parse(JSON.stringify(data.value!.problem.review));
    attempt.value.result = draft.value.awaitingEvaluation ? 'independent' : 'hint';
    snapshot.value = JSON.stringify(draft.value);
    if (!aiForm.value.code && draft.value.code) {
      aiForm.value.code = draft.value.code;
      aiForm.value.language = draft.value.language;
    }
    void loadAiReviews();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadAiReviews() {
  try {
    const [list, config] = await Promise.all([
      api<AiReviewRecord[]>('/problems/' + encodeURIComponent(key) + '/ai-reviews'),
      api<{ configured: boolean }>('/ai/settings'),
    ]);
    aiReviews.value = list.slice().reverse();
    aiConfigured.value = config.configured;
  } catch {
    // AI 历史读取失败不阻塞复盘笔记
  }
}
async function fetchSubmissionCode(submissionId: number) {
  if (fetchingSubmission.value) return;
  fetchingSubmission.value = submissionId;
  error.value = '';
  aiError.value = '';
  try {
    const result = await api<{ code: string; language: string; submissionId: number }>(
      '/problems/' + encodeURIComponent(key) + '/fetch-submission-code',
      { submissionId },
    );
    aiForm.value.code = result.code;
    if (result.language) aiForm.value.language = result.language;
    const submission = data.value?.submissions.find((s) => s.id === submissionId);
    if (submission?.verdict) aiForm.value.verdict = submission.verdict;
    tab.value = 'assistant';
    tool.value = 'code';
    notify('已获取提交代码，可开始 AI 分析');
  } catch (e) {
    const message = (e as Error).message;
    if (tab.value === 'assistant') aiError.value = message;
    else error.value = message;
  } finally {
    fetchingSubmission.value = 0;
    selectedSubmission.value = '';
  }
}
async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code);
    notify('代码已复制');
  } catch {
    notify('复制失败，请手动选择代码复制');
  }
}
function fillCode(record: AiReviewRecord) {
  draft.value.code = record.suggestedCode;
  if (record.language) draft.value.language = record.language;
  tab.value = 'notes';
  notify('已填入代码留档，确认后请保存');
}
async function submitAiReview() {
  if (aiBusy.value) return;
  aiBusy.value = true;
  aiError.value = '';
  try {
    const record = await api<AiReviewRecord>('/problems/' + encodeURIComponent(key) + '/ai-reviews', {
      code: aiForm.value.code,
      language: aiForm.value.language,
      verdict: aiForm.value.verdict,
      focus: aiForm.value.focus,
      statement: aiForm.value.statement,
    });
    aiReviews.value = [record, ...aiReviews.value];
    aiExpanded.value = record.id;
    notify('AI 分析完成');
  } catch (e) {
    aiError.value = (e as Error).message;
  } finally {
    aiBusy.value = false;
  }
}
async function deleteAiReview(id: string) {
  try {
    await api(
      '/problems/' + encodeURIComponent(key) + '/ai-reviews/' + encodeURIComponent(id),
      undefined,
      'DELETE',
    );
    aiReviews.value = aiReviews.value.filter((r) => r.id !== id);
    notify('已删除该条 AI 复盘');
  } catch (e) {
    aiError.value = (e as Error).message;
  }
}
function fillNote(field: 'rootCause' | 'counterexample' | 'wrongIdea', content: string) {
  const current = draft.value[field].trim();
  draft.value[field] = current ? current + '\n\n---\n\n' + content.trim() : content.trim();
  tab.value = 'notes';
  notify('已填入笔记，确认后请保存');
}
function fillReasons(points: string[]) {
  for (const p of points) if (!draft.value.reasons.includes(p)) draft.value.reasons.push(p);
  tab.value = 'notes';
  notify('已并入错因归类，确认后请保存');
}
async function save(action = 'save') {
  if (inFlightSave) return inFlightSave;
  inFlightSave = saveInner(action);
  try {
    await inFlightSave;
  } finally {
    inFlightSave = null;
  }
}
async function saveInner(action: string) {
  busy.value = true;
  error.value = '';
  try {
    const updated = await api<Review>(
      '/problems/' + encodeURIComponent(key) + '/review',
      { review: draft.value, action },
      'PUT',
    );
    draft.value = updated;
    snapshot.value = JSON.stringify(updated);
    await load();
    notify(action === 'restart' ? '已重新加入复习' : '复盘已保存');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function addReason() {
  const r = customReason.value.trim();
  if (r && !draft.value.reasons.includes(r)) draft.value.reasons.push(r);
  customReason.value = '';
}
async function toggleIgnore() {
  draft.value.ignored = !draft.value.ignored;
  await save();
}
async function submitAttempt() {
  busy.value = true;
  error.value = '';
  try {
    await api('/problems/' + encodeURIComponent(key) + '/attempts', attempt.value);
    await load();
    attempt.value = { result: 'hint', minutes: 0, note: '' };
    notify('评价已记录，复习安排已更新');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function unload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => {
  void load();
  window.addEventListener('beforeunload', unload);
});
onUnmounted(() => window.removeEventListener('beforeunload', unload));
async function confirmLeave() {
  if (inFlightSave) await inFlightSave;
  return !dirty.value || window.confirm('复盘内容尚未保存，确定离开吗？');
}
onBeforeRouteLeave(confirmLeave);
onBeforeRouteUpdate((to) => {
  if (String(to.params.key) !== key) return confirmLeave();
});
</script>
<template>
  <RouterLink class="back-link" to="/problems"><ArrowLeft :size="15" />返回错题库</RouterLink>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <template v-if="data"
    ><div class="page-head detail-head">
      <div>
        <div class="eyebrow">
          {{ data.problem.source === 'atcoder' ? 'ATCODER' : 'CODEFORCES' }} /
          {{
            data.problem.source === 'atcoder'
              ? data.problem.index
              : `${data.problem.contestId}${data.problem.index}`
          }}
        </div>
        <h1>{{ data.problem.name }}</h1>
        <RouterLink class="astra-context-link" :to="{ path: '/companion', query: { problemKey: key } }"
          >与星澪一起梳理这道题</RouterLink
        >
        <div class="detail-meta">
          <span class="rating"
            >{{ data.problem.rating ?? '暂无难度'
            }}{{ data.problem.source === 'atcoder' ? ' · AtCoder Problems 估计难度' : '' }}</span
          ><span v-for="t in data.problem.tags" :key="t" class="tag">{{ t }}</span
          ><span :class="['badge', draft.status]">{{ statusLabels[draft.status] }}</span
          ><span class="solve-label">{{ data.problem.solved ? '已 AC' : '尚未 AC' }}</span>
        </div>
      </div>
      <button
        v-if="draft.status !== 'mastered' && !draft.ignored"
        class="small-button"
        @click="focusEvaluation"
      >
        {{ draft.awaitingEvaluation ? '评价这次重做' : '记录重做' }}
      </button>
      <a class="button" :href="data.problem.url" target="_blank" rel="noreferrer"
        >查看原题<ExternalLink :size="15"
      /></a>
    </div>
    <div class="detail-layout">
      <section class="panel editor-panel">
        <div class="tabs">
          <button
            v-for="t in [
              { id: 'notes', label: '复盘笔记' },
              { id: 'submissions', label: '提交记录' },
              { id: 'attempts', label: '重做历史' },
              { id: 'assistant', label: '解题助手' },
            ]"
            :key="t.id"
            :class="{ active: tab === t.id }"
            @click="tab = t.id"
          >
            {{ t.label }}<small v-if="t.id === 'submissions'">{{ data.submissions.length }}</small
            ><small v-if="t.id === 'attempts'">{{ data.attempts.length }}</small>
          </button>
        </div>
        <div>
          <div v-show="tab === 'notes'" class="editor-body">
            <div class="editor-toolbar">
              <span class="subtle small">支持 Markdown · LaTeX · 代码高亮</span
              ><button class="small-button" @click="preview = !preview">
                <Eye :size="14" />{{ preview ? '继续编辑' : '预览笔记' }}
              </button>
            </div>
            <label class="field-title">错因归类</label>
            <div class="reason-picker">
              <label
                v-for="r in [...new Set([...reasonOptions, ...draft.reasons])]"
                :key="r"
                :class="{ picked: draft.reasons.includes(r) }"
                ><input v-model="draft.reasons" type="checkbox" :value="r" />{{ r }}</label
              >
            </div>
            <div class="inline-input">
              <input
                v-model="customReason"
                maxlength="80"
                aria-label="自定义错因"
                placeholder="添加自定义错因"
                @keydown.enter.prevent="addReason"
              /><button @click="addReason">添加</button>
            </div>
            <template v-if="data.problem.source === 'atcoder'">
              <label class="field-title">算法领域（手动标注，可多选）</label>
              <div class="reason-picker">
                <label
                  v-for="category in categoryNames"
                  :key="category"
                  :class="{ picked: draft.categories.includes(category) }"
                  ><input v-model="draft.categories" type="checkbox" :value="category" />{{ category }}</label
                >
              </div>
            </template>
            <div v-for="(field, i) in fields" :key="field.key" class="note-field">
              <label :for="field.key"
                ><span>0{{ i + 1 }}</span
                >{{ field.label }}</label
              ><Markdown v-if="preview && draft[field.key]" :text="draft[field.key]" />
              <p v-else-if="preview" class="subtle small">暂未填写</p>
              <textarea
                v-else
                :id="field.key"
                v-model="draft[field.key]"
                :rows="field.key === 'solution' ? 6 : 3"
                :placeholder="field.hint"
              ></textarea>
            </div>
            <div class="note-field">
              <label for="code"><span>06</span>代码留档</label
              ><select v-model="draft.language" aria-label="代码语言">
                <option value="cpp">C++</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="javascript">JavaScript</option>
                <option value="rust">Rust</option>
                <option value="go">Go</option></select
              ><Markdown
                v-if="preview"
                :text="'```' + draft.language + '\n' + draft.code + '\n```'"
              /><textarea
                v-else
                id="code"
                v-model="draft.code"
                class="code-input"
                rows="10"
                spellcheck="false"
                placeholder="粘贴你的代码，不会自动执行"
              ></textarea>
            </div>
            <div class="editor-actions">
              <span :class="['small', dirty ? 'unsaved' : 'subtle']">{{
                dirty ? '有未保存的修改' : '内容已保存'
              }}</span
              ><button :disabled="busy" @click="save()"><Save :size="15" />保存笔记</button>
            </div>
            <details v-if="qualityHints.length" class="review-quality small">
              <summary>复盘质量提示（可跳过）</summary>
              <p v-for="hint in qualityHints" :key="hint">{{ hint }}</p>
            </details>
          </div>
          <div v-if="tab === 'submissions'" class="editor-body">
            <p class="subtle small">AC 表示通过评测；是否真正掌握，由你的独立重做记录决定。</p>
            <div v-if="!data.submissions.length" class="quiet-empty">暂无提交记录，这是手动添加的题目。</div>
            <div v-for="s in data.submissions" :key="s.id" class="timeline-row">
              <span :class="['verdict', s.verdict === 'OK' ? 'ok' : '']">{{
                verdictLabel[s.verdict || ''] || s.verdict || '待判'
              }}</span>
              <div>
                <a
                  :href="
                    s.source === 'atcoder'
                      ? `https://atcoder.jp/contests/${s.contestKey}/submissions/${s.id}`
                      : `https://codeforces.com/${(s.contestId || 0) >= 100000 ? 'gym' : 'contest'}/${s.contestId}/submission/${s.id}`
                  "
                  target="_blank"
                  rel="noreferrer"
                  >#{{ s.id }} <ExternalLink :size="12" /></a
                ><small
                  >{{ s.programmingLanguage }} ·
                  {{
                    s.author.participantType === 'PRACTICE'
                      ? '练习'
                      : s.author.participantType === 'VIRTUAL'
                        ? '虚拟参赛'
                        : '正式 / 其他参赛'
                  }}</small
                >
              </div>
              <time>{{ fullDate(new Date(s.creationTimeSeconds * 1000).toISOString()) }}</time>
              <button
                class="small-button"
                :disabled="!!fetchingSubmission"
                @click="fetchSubmissionCode(s.id)"
              >
                {{ fetchingSubmission === s.id ? '获取中…' : '获取代码并分析' }}
              </button>
            </div>
          </div>
          <div v-show="tab === 'assistant'" class="editor-body">
            <nav class="content-switcher" aria-label="解题助手工具">
              <button
                v-for="item in [
                  { id: 'code', label: '代码分析' },
                  { id: 'hints', label: '分步提示' },
                  { id: 'stress', label: '反例对拍' },
                  { id: 'experience', label: '经验沉淀' },
                  { id: 'transfer', label: '迁移练习' },
                ]"
                :key="item.id"
                :class="{ active: tool === item.id }"
                @click="tool = item.id as typeof tool"
              >
                {{ item.label }}
              </button>
            </nav>
            <p class="subtle small">工具共用下方代码、语言和题目上下文；分析建议需确认后保存到笔记。</p>
            <p v-show="tool === 'code'" class="subtle small">
              粘贴一段代码，AI
              会分析错误原因、评价思路、生成反例并推荐知识点。结果仅供参考，请结合评测与自己的重做判断。
            </p>
            <div v-if="!aiConfigured" class="alert">
              尚未配置 AI 服务。请前往<RouterLink to="/settings?view=ai">设置与数据 → AI 助手</RouterLink
              >填写接口地址、密钥与模型。
            </div>
            <button
              v-if="!['code', 'stress'].includes(tool)"
              class="small-button"
              @click="showSharedCode = !showSharedCode"
            >
              {{ showSharedCode ? '收起共用代码' : '查看共用代码与语言' }}
            </button>
            <div v-show="['code', 'stress'].includes(tool) || showSharedCode" class="note-field">
              <label for="ai-code"><span>01</span>待分析代码</label>
              <div class="editor-toolbar">
                <select
                  v-if="data.submissions.length"
                  v-model="selectedSubmission"
                  aria-label="从提交记录获取代码"
                  :disabled="!!fetchingSubmission"
                  @change="selectedSubmission && fetchSubmissionCode(Number(selectedSubmission))"
                >
                  <option value="">从提交记录获取代码…</option>
                  <option v-for="s in data.submissions" :key="s.id" :value="String(s.id)">
                    #{{ s.id }} · {{ s.programmingLanguage }} ·
                    {{ verdictLabel[s.verdict || ''] || s.verdict || '待判' }}
                  </option></select
                ><select v-model="aiForm.language" aria-label="代码语言">
                  <option value="cpp">C++</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="javascript">JavaScript</option>
                  <option value="rust">Rust</option>
                  <option value="go">Go</option></select
                ><select v-model="aiForm.verdict" aria-label="评测结果">
                  <option value="">评测结果（可选）</option>
                  <option v-for="v in aiVerdictOptions" :key="v" :value="v">
                    {{ verdictLabel[v] || v }}
                  </option>
                </select>
              </div>
              <textarea
                id="ai-code"
                v-model="aiForm.code"
                class="code-input"
                rows="10"
                spellcheck="false"
                placeholder="粘贴需要分析的代码（默认带入「代码留档」内容）"
              ></textarea>
            </div>
            <details class="ai-extra" :open="tool !== 'code'">
              <summary class="small">补充上下文（可选）：题目描述 · 希望 AI 重点关注的问题</summary>
              <textarea
                v-model="aiForm.statement"
                aria-label="题面与输入输出约束"
                rows="3"
                placeholder="粘贴题目描述，AI 的反例与复杂度判断会更准确"
              ></textarea>
              <textarea
                v-model="aiForm.focus"
                rows="2"
                placeholder="例如：我怀疑边界条件有问题 / 帮我看看复杂度"
              ></textarea>
            </details>
            <LearningProblem
              v-if="learningOpened"
              v-show="tool !== 'code'"
              :tool="tool"
              :problem-key="key"
              :code="aiForm.code"
              :language="aiForm.language"
              :statement="aiForm.statement"
              :ai-reviews="aiReviews"
            />
            <div v-show="tool === 'code'">
              <div class="editor-actions">
                <span class="small subtle">AI 每次分析都会留档在下方历史中</span
                ><button
                  class="primary"
                  :disabled="aiBusy || !aiForm.code.trim() || !aiConfigured"
                  @click="submitAiReview"
                >
                  <Sparkles :size="15" />{{ aiBusy ? 'AI 分析中…' : '开始 AI 分析' }}
                </button>
              </div>
              <div v-if="aiError" class="alert error" role="alert">{{ aiError }}</div>
              <div v-if="!aiReviews.length && !aiBusy" class="quiet-empty">
                还没有 AI 复盘记录。提交代码后，分析结果会保存在这里。
              </div>
              <article v-for="r in aiReviews" :key="r.id" class="attempt-entry ai-entry">
                <div class="ai-entry-head">
                  <button class="ai-entry-title" @click="aiExpanded = aiExpanded === r.id ? null : r.id">
                    <span class="badge reviewing">AI</span
                    ><span
                      >{{ r.model }} · {{ verdictLabel[r.verdict] || r.verdict || '未指定结果' }} ·
                      {{ fullDate(r.createdAt) }}</span
                    >
                  </button>
                  <button
                    class="icon-button"
                    aria-label="删除该条 AI 复盘"
                    :disabled="aiBusy"
                    @click="deleteAiReview(r.id)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
                <template v-if="aiExpanded === r.id">
                  <section class="ai-section">
                    <div class="ai-section-head">
                      <h3>错误原因</h3>
                      <button class="small-button" @click="fillNote('rootCause', r.errorAnalysis)">
                        填入「根本原因」
                      </button>
                    </div>
                    <Markdown :text="r.errorAnalysis" />
                  </section>
                  <section class="ai-section">
                    <div class="ai-section-head">
                      <h3>思路评价</h3>
                      <button class="small-button" @click="fillNote('wrongIdea', r.approachEvaluation)">
                        追加到「当时的思路」
                      </button>
                    </div>
                    <Markdown :text="r.approachEvaluation" />
                  </section>
                  <section v-if="r.counterexamples.length" class="ai-section">
                    <div class="ai-section-head">
                      <h3>反例</h3>
                      <button
                        class="small-button"
                        @click="fillNote('counterexample', r.counterexamples.join('\n\n---\n\n'))"
                      >
                        填入「关键反例与边界」
                      </button>
                    </div>
                    <Markdown v-for="(c, i) in r.counterexamples" :key="i" :text="c" />
                  </section>
                  <section v-if="r.suggestedCode" class="ai-section">
                    <div class="ai-section-head">
                      <h3>代码建议</h3>
                      <div class="ai-section-actions">
                        <button class="small-button" @click="copyCode(r.suggestedCode)">复制代码</button>
                        <button class="small-button" @click="fillCode(r)">填入代码留档</button>
                      </div>
                    </div>
                    <Markdown :text="'```' + r.language + '\n' + r.suggestedCode + '\n```'" />
                  </section>
                  <section class="ai-section">
                    <div class="ai-section-head">
                      <h3>推荐知识点</h3>
                      <button
                        v-if="r.suggestedReasons.length"
                        class="small-button"
                        @click="fillReasons(r.suggestedReasons)"
                      >
                        并入「错因归类」
                      </button>
                    </div>
                    <div class="reason-picker ai-points">
                      <span v-for="p in r.knowledgePoints" :key="p" class="tag">{{ p }}</span>
                    </div>
                  </section>
                </template>
              </article>
            </div>
          </div>
          <div v-if="tab === 'attempts'" class="editor-body">
            <div v-if="!data.attempts.length" class="quiet-empty">
              重做后记录结果，这里会留下你的理解轨迹。
            </div>
            <article v-for="a in data.attempts" :key="a.id" class="attempt-entry">
              <div>
                <span :class="['badge', a.result === 'independent' ? 'mastered' : 'pending']">{{
                  resultLabels[a.result]
                }}</span
                ><span>{{ a.minutes }} 分钟 · {{ fullDate(a.createdAt) }}</span>
              </div>
              <Markdown :text="a.note" />
            </article>
          </div>
        </div>
      </section>
      <aside class="detail-side">
        <section class="panel side-card">
          <span class="eyebrow">SPACED PRACTICE</span>
          <h2>理解，需要再验证</h2>
          <div class="stage-track">
            <span v-for="n in 5" :key="n" :class="{ done: n <= draft.stage }">{{
              n <= draft.stage ? '✓' : n
            }}</span>
          </div>
          <p class="small subtle">
            {{ draft.status === 'mastered' ? '五轮独立重做已完成。' : '依次独立重做，逐步拉长复习间隔。'
            }}<br />次日 → 3 天 → 7 天 → 14 天 → 30 天
          </p>
          <p v-if="draft.awaitingEvaluation" class="small">
            当天 AC 已确认重做完成；请评价是否独立做对。评价前不安排下次复习。
          </p>
          <p
            v-if="draft.firstReflectionRequired && draft.firstRedoAt && !draft.firstReflectionAt"
            class="small"
          >
            首次重做后，请在左侧至少填写一项分析并保存，完成今天的复盘步骤。
          </p>
          <p v-if="draft.status === 'pending' && !draft.firstRedoAt" class="small">
            先打开原题重做；当天 CF AC 会自动确认重做完成。未 AC 时也可记录一次尝试。
          </p>
          <label v-if="draft.status === 'reviewing'"
            >下次复习日期<input v-model="nextDate" type="date" /></label
          ><button v-if="draft.status === 'reviewing'" class="wide" :disabled="busy" @click="save()">
            保存日期与笔记</button
          ><button v-if="draft.status === 'mastered'" class="wide" :disabled="busy" @click="save('restart')">
            <RotateCcw :size="15" />重新加入复习
          </button>
          <div v-if="draft.ignored" class="alert">此题已忽略，不会出现在复习队列中。</div>
        </section>
        <section
          ref="evaluationCard"
          v-if="draft.status !== 'mastered' && !draft.ignored"
          class="panel side-card"
        >
          <h2><Clock3 :size="18" />{{ draft.awaitingEvaluation ? '评价这次重做' : '重做与尝试' }}</h2>
          <p class="small subtle">
            {{
              draft.awaitingEvaluation
                ? 'AC 只确认通过；是否独立完成由你评价。'
                : '先打开原题重做。没有当天 AC 时，可以记录借助提示或仍未做出。'
            }}
          </p>
          <form @submit.prevent="submitAttempt">
            <label
              >重做结果<select v-model="attempt.result">
                <option value="independent" :disabled="!draft.awaitingEvaluation">
                  独立做对（需当天 AC）
                </option>
                <option value="hint">借助提示</option>
                <option value="failed">仍未做出</option>
              </select></label
            ><label
              >耗时（分钟）<input
                v-model.number="attempt.minutes"
                required
                type="number"
                min="0"
                step="0.5" /></label
            ><label
              >新的发现<textarea
                v-model="attempt.note"
                rows="3"
                placeholder="这次还有哪里不熟悉？"
              ></textarea></label
            ><button class="primary wide" :disabled="busy || dirty">
              {{ draft.awaitingEvaluation ? '保存评价' : '记录尝试' }}
            </button>
            <p v-if="dirty" class="small unsaved">请先保存笔记，再记录重做结果。</p>
          </form>
        </section>
        <button class="quiet-button wide" :disabled="busy" @click="toggleIgnore">
          <EyeOff :size="16" />{{ draft.ignored ? '恢复此题' : '暂时忽略此题' }}
        </button>
      </aside>
    </div></template
  >
  <div v-else-if="!error" class="empty-state">正在读取题目…</div>
</template>
