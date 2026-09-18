import { ref } from 'vue';
import type { Settings, SyncJob } from '../shared/domain';
export const browserMode = import.meta.env.VITE_STORAGE_MODE === 'browser';
export const settings = ref<Settings>({ activeHandle: '', handles: [] });
export const job = ref<SyncJob | null>(null);
export const toast = ref('');
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
  if (browserMode) return (await import('./browser/api')).browserApi<T>(path, body, method);
  const response = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Review-App': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error([data.error, ...(data.details || [])].join('；'));
  return data;
}
export async function loadSettings() {
  settings.value = await api<Settings>('/settings');
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
