<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
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
md.renderer.rules.math_inline = (tokens, i) =>
  katex.renderToString(tokens[i].content, { throwOnError: false, trust: false, strict: 'ignore' });
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
md.renderer.rules.math_block = (tokens, i) =>
  katex.renderToString(tokens[i].content, {
    throwOnError: false,
    trust: false,
    displayMode: true,
    strict: 'ignore',
  });
const html = computed(() => md.render(props.text));
</script>
<template><div class="markdown" v-html="html"></div></template>
