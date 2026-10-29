import { build } from 'esbuild';

// 桌面端产物：main.cjs 是 Electron 主进程（electron 保持外部依赖），
// server.cjs 是后端子进程入口（node_modules 依赖保持外部，随安装包分发）。
await Promise.all([
  build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    // electron-updater must stay external: it resolves from the packaged
    // node_modules and its dynamic requires break when bundled.
    external: ['electron', 'electron-updater'],
    outfile: 'electron-dist/main.cjs',
  }),
  build({
    entryPoints: ['electron/server-main.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    outfile: 'electron-dist/server.cjs',
  }),
]);
console.log('desktop bundles: electron-dist/main.cjs + electron-dist/server.cjs');
