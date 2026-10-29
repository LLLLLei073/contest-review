import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';

let window: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let serverPort = 0;
let stoppingServer = false;
let quitting = false;

// 安装版通过 GitHub Releases 自动更新：启动 15 秒后首查、之后每 6 小时复查，
// 后台静默下载，完成后询问是否立即重启；下载失败只记日志，绝不打扰使用。
// 便携版（electron-builder 注入 PORTABLE_EXECUTABLE_DIR）无法自我替换，跳过。
function setupAutoUpdate() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.on('error', (error) => console.error('[update]', (error as Error).message));
    autoUpdater.on('update-downloaded', (info) => {
      void dialog
        .showMessageBox({
          type: 'info',
          title: '回解更新',
          message: `新版本 v${info.version} 已下载，重启后生效。`,
          buttons: ['重启更新', '稍后'],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response !== 0) return;
          quitting = true; // before-quit 不再拦截；服务器由这里显式收尾。
          void stopServer().finally(() => autoUpdater.quitAndInstall(true, false));
        });
    });
    const check = () => void autoUpdater.checkForUpdates().catch(() => {});
    setTimeout(check, 15000);
    setInterval(check, 6 * 60 * 60 * 1000);
  } catch (error) {
    console.error('[update] 初始化失败：', (error as Error).message);
  }
}

// 后端子进程用 ELECTRON_RUN_AS_NODE 复用 Electron 自带的 Node 运行时，
// 与主进程同版本；node:sqlite 自 Node 22.13 起免旗标，旧版本需显式开启。
function sqliteFlags(): string[] {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 13) ? [] : ['--experimental-sqlite'];
}

function startServer(): Promise<void> {
  const root = app.isPackaged ? app.getAppPath() : join(__dirname, '..');
  const bundle = join(__dirname, 'server.cjs');
  if (!existsSync(bundle))
    throw new Error('缺少后端入口 electron-dist/server.cjs，请先运行 npm run desktop:build。');
  if (!existsSync(join(root, 'dist', 'index.html')))
    throw new Error('缺少前端产物 dist/，请先运行 npm run desktop:build。');
  const dataDir = app.isPackaged ? join(app.getPath('userData'), 'data') : join(root, 'data');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [...sqliteFlags(), bundle], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    server = child;
    let stderr = '';
    const finish = (error?: Error) => {
      clearTimeout(failTimer);
      child.stdout?.off('data', onStdout);
      child.off('exit', onExit);
      error ? reject(error) : resolvePromise();
    };
    const failTimer = setTimeout(() => finish(new Error('后端启动超时（30 秒）。')), 30000);
    const onStdout = (chunk: Buffer) => {
      process.stdout.write(chunk);
      const match = String(chunk).match(/READY_PORT=(\d+)/);
      if (match && !serverPort) {
        serverPort = Number(match[1]);
        finish();
      }
    };
    const onExit = (code: number | null) => {
      server = null;
      finish(new Error(`后端进程提前退出（code=${code ?? 'null'}）。${stderr.slice(-800)}`));
    };
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr += String(chunk);
    });
    child.on('exit', onExit);
    child.on('error', (error) => finish(error));
  });
}

function stopServer(): Promise<void> {
  const child = server;
  if (!child || stoppingServer) return Promise.resolve();
  stoppingServer = true;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => child.kill(), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      server = null;
      resolvePromise();
    });
    try {
      child.send('shutdown');
    } catch {
      child.kill();
    }
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: '回解',
    show: false,
    backgroundColor: '#111418',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  window.once('ready-to-show', () => window?.show());
  const origin = `http://127.0.0.1:${serverPort}`;
  const isExternal = (url: string) => {
    if (!url.startsWith(origin)) {
      void shell.openExternal(url);
      return true;
    }
    return false;
  };
  window.webContents.setWindowOpenHandler(({ url }) => ({ action: isExternal(url) ? 'deny' : 'allow' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (isExternal(url)) event.preventDefault();
  });
  void window.loadURL(origin + '/');
  window.on('closed', () => (window = null));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.setAppUserModelId('com.lei073.contestreview');
  if (app.isPackaged) Menu.setApplicationMenu(null);

  void app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (error) {
      dialog.showErrorBox('回解启动失败', (error as Error).message);
      app.quit();
      return;
    }
    createWindow();
    setupAutoUpdate();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    quitting = true;
    event.preventDefault();
    void stopServer().finally(() => app.quit());
  });
}
