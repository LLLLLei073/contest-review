<script setup lang="ts">
import { computed, ref } from 'vue';
import { Eye, Save } from 'lucide-vue-next';
import { reasonOptions, type Review } from '../../../shared/domain';
import { categoryNames } from '../../../shared/training';
import { reviewQualityHints } from '../../../shared/training-extras';
import Markdown from '../Markdown.vue';
const draft = defineModel<Review>({ required: true });
defineProps<{ dirty: boolean; busy: boolean; atcoder: boolean }>();
const emit = defineEmits<{ save: [] }>();
const preview = ref(false),
  customReason = ref('');
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

const qualityHints = computed(() => reviewQualityHints(draft.value));
function addReason() {
  const r = customReason.value.trim();
  if (r && !draft.value.reasons.includes(r)) draft.value.reasons.push(r);
  customReason.value = '';
}

function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'auto' });
  document.getElementById(id)?.focus({ preventScroll: true });
}
</script>
<template>
  <div class="editor-body">
    <div class="editor-toolbar">
      <span class="subtle small">支持 Markdown · LaTeX · 代码高亮</span
      ><button class="small-button" @click="preview = !preview">
        <Eye :size="14" />{{ preview ? '继续编辑' : '预览笔记' }}
      </button>
    </div>
    <nav class="review-steps" aria-label="复盘步骤">
      <button v-for="(field, i) in fields" :key="field.key" class="small-button" @click="goTo(field.key)">
        <span>{{ draft[field.key].trim() ? '✓' : i + 1 }}</span
        >{{ field.label }}
      </button>
    </nav>
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
    <template v-if="atcoder">
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
      ><button :disabled="busy" @click="emit('save')"><Save :size="15" />保存笔记</button>
    </div>
    <details v-if="qualityHints.length" class="review-quality small">
      <summary>复盘质量提示（可跳过）</summary>
      <p v-for="hint in qualityHints" :key="hint">{{ hint }}</p>
    </details>
  </div>
</template>
<style scoped>
.review-steps {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 18px 0 28px;
}
.review-steps button {
  font-size: 12px;
  min-height: 36px;
}
.review-steps span {
  color: var(--highlight);
}
.editor-actions {
  z-index: 2;
  padding: 14px 0;
  background: var(--paper);
}
@media (max-width: 650px) {
  .editor-actions {
    bottom: calc(var(--mobile-nav-height) + env(safe-area-inset-bottom));
    flex-wrap: wrap;
  }
}
</style>
