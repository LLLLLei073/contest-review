<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { ArrowLeft, ExternalLink, Save, CheckCheck, RotateCcw, Eye, EyeOff, Clock3 } from 'lucide-vue-next';
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
import Markdown from '../components/Markdown.vue';
const route = useRoute(),
  key = String(route.params.key);
const data = ref<{ problem: ProblemRow; submissions: CFSubmission[]; attempts: Attempt[] } | null>(null),
  draft = ref<Review>(emptyReview()),
  snapshot = ref(''),
  tab = ref('notes'),
  preview = ref(false),
  error = ref(''),
  busy = ref(false),
  customReason = ref('');
const attempt = ref<{ result: 'independent' | 'hint' | 'failed'; minutes: number; note: string }>({
  result: 'independent',
  minutes: 0,
  note: '',
});
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
const dirty = computed(() => JSON.stringify(draft.value) !== snapshot.value);
const nextDate = computed({
  get: () => (draft.value.nextReview ? localDate(draft.value.nextReview) : ''),
  set: (v) => (draft.value.nextReview = v ? new Date(v + 'T09:00:00').toISOString() : null),
});
async function load() {
  try {
    data.value = await api('/problems/' + encodeURIComponent(key));
    draft.value = JSON.parse(JSON.stringify(data.value!.problem.review));
    snapshot.value = JSON.stringify(draft.value);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function save(action = 'save') {
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
    notify(
      action === 'complete'
        ? '复盘已完成，明天开始重做'
        : action === 'restart'
          ? '已重新加入复习'
          : '复盘已保存',
    );
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
    attempt.value = { result: 'independent', minutes: 0, note: '' };
    notify('重做结果已记录，复习安排已更新');
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
onBeforeRouteLeave(() => !dirty.value || window.confirm('复盘内容尚未保存，确定离开吗？'));
</script>
<template>
  <RouterLink class="back-link" to="/problems"><ArrowLeft :size="15" />返回错题库</RouterLink>
  <div v-if="error" class="alert error" role="alert">{{ error }}</div>
  <template v-if="data"
    ><div class="page-head detail-head">
      <div>
        <div class="eyebrow">CODEFORCES / {{ data.problem.contestId }}{{ data.problem.index }}</div>
        <h1>{{ data.problem.name }}</h1>
        <div class="detail-meta">
          <span class="rating">{{ data.problem.rating ?? '暂无难度' }}</span
          ><span v-for="t in data.problem.tags" :key="t" class="tag">{{ t }}</span
          ><span :class="['badge', draft.status]">{{ statusLabels[draft.status] }}</span
          ><span class="solve-label">{{ data.problem.solved ? '已 AC' : '尚未 AC' }}</span>
        </div>
      </div>
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
            ]"
            :key="t.id"
            :class="{ active: tab === t.id }"
            @click="tab = t.id"
          >
            {{ t.label }}<small v-if="t.id === 'submissions'">{{ data.submissions.length }}</small
            ><small v-if="t.id === 'attempts'">{{ data.attempts.length }}</small>
          </button>
        </div>
        <div v-if="tab === 'notes'" class="editor-body">
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
            ><Markdown v-if="preview" :text="'```' + draft.language + '\n' + draft.code + '\n```'" /><textarea
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
            ><button :disabled="busy" @click="save()"><Save :size="15" />保存笔记</button
            ><button
              v-if="draft.status === 'pending'"
              class="primary"
              :disabled="busy"
              @click="save('complete')"
            >
              <CheckCheck :size="16" />完成复盘
            </button>
          </div>
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
                :href="`https://codeforces.com/${(s.contestId || 0) >= 100000 ? 'gym' : 'contest'}/${s.contestId}/submission/${s.id}`"
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
          </div>
        </div>
        <div v-if="tab === 'attempts'" class="editor-body">
          <div v-if="!data.attempts.length" class="quiet-empty">重做后记录结果，这里会留下你的理解轨迹。</div>
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
          <label v-if="draft.status === 'reviewing'"
            >下次复习日期<input v-model="nextDate" type="date" /></label
          ><button v-if="draft.status === 'reviewing'" class="wide" :disabled="busy" @click="save()">
            保存日期与笔记</button
          ><button v-if="draft.status === 'mastered'" class="wide" :disabled="busy" @click="save('restart')">
            <RotateCcw :size="15" />重新加入复习
          </button>
          <div v-if="draft.ignored" class="alert">此题已忽略，不会出现在复习队列中。</div>
        </section>
        <section v-if="draft.status === 'reviewing' && !draft.ignored" class="panel side-card">
          <h2><Clock3 :size="18" />记录这次重做</h2>
          <p class="small subtle">合上题解，独立推导与实现后再记录。</p>
          <form @submit.prevent="submitAttempt">
            <label
              >重做结果<select v-model="attempt.result">
                <option value="independent">独立做对</option>
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
            ><button class="primary wide" :disabled="busy || dirty">记录结果</button>
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
