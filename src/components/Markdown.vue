<script setup lang="ts">
import { computed, ref } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

// katex（约 280KB）不进首帧：模块级惰性加载，组件挂载即预热下载；就绪前公式
// 先显示转义原文，就绪后整体重算。/knowledge、/contests 首屏各减约 300KB。
// 结构化类型：katex 的 CJS 导出与其 d.ts 的模块形态不一致，别用 typeof import。
interface KatexLike {
  renderToString: (
    tex: string,
    options?: { throwOnError?: boolean; trust?: boolean; displayMode?: boolean; strict?: 'ignore' },
  ) => string;
}
let katexModule: KatexLike | null = null;
let katexLoading: Promise<KatexLike> | null = null;
const mathReady = ref(false);
const ensureKatex = (): Promise<KatexLike> => {
  if (katexModule) return Promise.resolve(katexModule);
  katexLoading ??= import('katex').then((m) => {
    const mod = (m as { default?: unknown }).default ?? m;
    katexModule = mod as KatexLike;
    mathReady.value = true;
    return katexModule;
  });
  return katexLoading;
};
const renderMath = (tex: string, displayMode: boolean) => {
  if (!mathReady.value) return MarkdownIt().utils.escapeHtml(displayMode ? `$$${tex}$$` : `$${tex}$`);
  return katexModule!.renderToString(tex, {
    throwOnError: false,
    trust: false,
    displayMode,
    strict: 'ignore',
  });
};
const props = defineProps<{ text: string }>();
Object.entries({ cpp, python, java, javascript, rust, go }).forEach(([name, language]) =>
  hljs.registerLanguage(name, language),
);
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: (code, lang) =>
    lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }).value : '',
});
md.inline.ruler.before('escape', 'math', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;
  const end = state.src.indexOf('$', state.pos + 1);
  if (end < 0) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = state.src.slice(state.pos + 1, end);
  }
  state.pos = end + 1;
  return true;
});
md.renderer.rules.math_inline = (tokens, i) => renderMath(tokens[i].content, false);
md.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
  const first = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  if (!first.startsWith('$$')) return false;
  let last = start,
    content = first.slice(2),
    closed = content.endsWith('$$');
  if (closed) content = content.slice(0, -2);
  else {
    for (last = start + 1; last < end; last++) {
      const line = state.src.slice(state.bMarks[last], state.eMarks[last]);
      if (line.trim().endsWith('$$')) {
        content += '\n' + line.slice(0, line.lastIndexOf('$$'));
        closed = true;
        break;
      }
      content += '\n' + line;
    }
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push('math_block', 'math', 0);
  token.content = content;
  token.block = true;
  state.line = last + 1;
  return true;
});
md.renderer.rules.math_block = (tokens, i) => renderMath(tokens[i].content, true);
const html = computed(() => md.render(props.text));
void ensureKatex();
</script>
<template><div class="markdown" v-html="html"></div></template>
