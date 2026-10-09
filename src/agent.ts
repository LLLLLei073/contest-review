import { ref } from 'vue';
import { api, browserMode } from './api';
import type { AgentEvent, AgentRecord } from '../shared/agent-domain';

export const astraSuggestion = ref<Extract<AgentRecord, { kind: 'suggestion' }> | null>(null);
let pending = false;
export async function checkAstraSuggestion() {
  if (pending) return;
  pending = true;
  try {
    astraSuggestion.value = await api('/agent/suggestion', {});
  } catch {
    /* Optional companionship never interrupts learning. */
  } finally {
    pending = false;
  }
}
export async function dismissAstraSuggestion() {
  if (astraSuggestion.value) await api('/agent/dismiss', { id: astraSuggestion.value.id });
  astraSuggestion.value = null;
}
export async function streamAgent(
  input: { sessionId: string; requestId: string; message: string },
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  if (browserMode) {
    const { browserRuntime } = await import('./browser/database');
    const runtime = await browserRuntime();
    runtime.assertWritable();
    const { AgentService } = await import('../shared/agent-service');
    const service = new AgentService(runtime.store, undefined, () => runtime.flush());
    const cancel = () => {
      void service.route('cancel', 'POST', { sessionId: input.sessionId }).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for await (const event of service.run(input)) {
        if (signal.aborted) break;
        onEvent(event);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    return;
  }
  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Review-App': '1' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error((await response.json()).error ?? '无法开始对话');
  if (!response.body) throw new Error('当前浏览器不支持流式回答');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim()) onEvent(JSON.parse(line));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
