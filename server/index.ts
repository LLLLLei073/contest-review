import { resolve } from 'node:path';
import { Store } from './store.js';
import { buildApp } from './app.js';
const store = new Store(resolve(process.env.DATA_DIR || 'data', 'review.sqlite'));
const { app, sync } = await buildApp(store, undefined, {
  dev: process.env.NODE_ENV !== 'production',
  logger: true,
});
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT || 3210) });
console.log('\n回解已启动：http://127.0.0.1:' + (process.env.PORT || 3210) + '\n');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  sync.stop();
  await app.close();
  if (sync.running) await sync.running;
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
