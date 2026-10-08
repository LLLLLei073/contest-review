import { ref } from 'vue';
import type { Settings, SyncJob } from '../shared/domain';
export const browserMode = import.meta.env.VITE_STORAGE_MODE === 'browser';
export const settings = ref<Settings>({ activeHandle: '', handles: [] });
let settingsRead = 0;
export const job = ref<SyncJob | null>(null);
export const toast = ref('');
export const dataRevision = ref(0);
export const recentChecks = ref(0);
let lastLearningSync = '';
const lastReportSync = new Map<string, string>();
function learningFeedback(path: string, method: string, data: unknown) {
  if (method !== 'GET' && path !== '/learning/monthly-report') dataRevision.value++;
  if (['/atcoder/sync', '/review/batch'].includes(path) && data && typeof data === 'object') {
    const status = data as { id?: string; status?: string; processed?: number };
    const signature = `${status.id}:${status.status}:${status.processed}`;
    if (
      status.id &&
      ['completed', 'failed', 'interrupted'].includes(status.status ?? '') &&
      lastReportSync.get(path) !== signature
    ) {
      lastReportSync.set(path, signature);
      dataRevision.value++;
    }
  }
  const sync = path === '/sync' && data && typeof data === 'object' ? (data as SyncJob) : null;
  const finished = sync?.status === 'completed' && lastLearningSync !== sync.id;
  if (finished) lastLearningSync = sync!.id;
  if (finished) dataRevision.value++;
  if (
    finished ||
    path === '/training/day' ||
    path === '/training/recent' ||
    (method !== 'GET' && /\/(attempts|review|transfer-result|diagnose|coach)$/.test(path))
  )
    void import('./learning').then((m) => m.checkLearningAgent());
}
let timer: ReturnType<typeof setTimeout>;
export function notify(message: string) {
  toast.value = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.value = ''), 4500);
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const recent = path === '/training/recent';
  if (recent) recentChecks.value++;
  try {
    if (browserMode) {
      const result = await (await import('./browser/api')).browserApi<T>(path, body, method);
      learningFeedback(path, method, result);
      return result;
    }
    const response = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Review-App': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error([data.error, ...(data.details || [])].join('；'));
    learningFeedback(path, method, data);
    return data;
  } finally {
    if (recent) recentChecks.value--;
  }
}
export async function loadSettings() {
  const read = ++settingsRead;
  const next = await api<Settings>('/settings');
  if (read === settingsRead) settings.value = next;
}
export async function loadJob() {
  job.value = await api<SyncJob | null>('/sync');
}
export function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '—';
}
export function fullDate(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}
export const statusLabels = { pending: '待复盘', reviewing: '复习中', mastered: '已掌握' };
export const resultLabels = { independent: '独立做对', hint: '借助提示', failed: '仍未做出' };
export function localDate(value: string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
