import { contextBridge, ipcRenderer } from 'electron';

// 沙箱 preload：只暴露更新检查的最小接口（state/check/install + 事件订阅），
// 其余渲染能力不受影响。桌面安装版专用；便携版与开发模式由主进程返回状态说明。
contextBridge.exposeInMainWorld('huijieUpdate', {
  state: () => ipcRenderer.invoke('update:state'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  onEvent: (listener: (payload: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('update:event', wrapped);
    return () => ipcRenderer.removeListener('update:event', wrapped);
  },
});
