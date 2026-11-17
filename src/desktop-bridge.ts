// 桌面端主动更新入口（electron/preload.ts 注入 window.huijieUpdate）。
// 浏览器/Pages 模式下不存在，调用前用 desktopUpdate() 判空。

export interface DesktopUpdateState {
  channel: 'install' | 'portable' | 'dev';
  currentVersion: string;
  lastCheckAt: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
}
export interface DesktopUpdateEvent {
  type: 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}
interface HuijieUpdateBridge {
  state: () => Promise<DesktopUpdateState>;
  check: () => Promise<{ started: boolean }>;
  install: () => Promise<{ installed: boolean }>;
  onEvent: (listener: (payload: DesktopUpdateEvent) => void) => () => void;
}
declare global {
  interface Window {
    huijieUpdate?: HuijieUpdateBridge;
  }
}
export const desktopUpdate = (): HuijieUpdateBridge | null => window.huijieUpdate ?? null;
