import { resolve } from 'node:path';
import { buildApp } from '../server/app.js';
import { Store } from '../server/store.js';

// 桌面端后端入口：与 server/index.ts 同构，但监听随机端口并把实际端口
// 以 READY_PORT=<n> 打到 stdout，供 Electron 主进程解析后加载窗口。
async function main() {
  const store = new Store(resolve(process.env.DATA_DIR || 'data', 'review.sqlite'));
  const { app, sync, analysis, hub } = await buildApp(store, undefined, { dev: false });
  await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 0) });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  console.log(`READY_PORT=${port}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    sync.stop();
    hub.stop();
    await app.close();
    if (sync.running) await sync.running;
    if (analysis.running) await analysis.running;
    if (hub.running) await hub.running;
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
  process.on('message', (message) => {
    if (message === 'shutdown') void close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
