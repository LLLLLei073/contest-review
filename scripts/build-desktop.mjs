import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

// 桌面端产物：main.cjs 是 Electron 主进程，server.cjs 是后端子进程入口。
// 后端把 npm 依赖全部打进单文件：安装包里若带完整 node_modules（上万个小文件），
// 便携版每次启动都要先把它们逐个解压复制到临时目录，要等好几分钟才出窗口。
// 因此 package.json 的 dependencies 只保留必须随包分发的 electron-updater。
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
    outfile: 'electron-dist/server.cjs',
  }),
]);
console.log('desktop bundles: electron-dist/main.cjs + electron-dist/server.cjs');

// 输出目录若继承了低完整性标签（项目放在被沙箱工具打了 Low 标签的桌面文件夹里时），
// 从这里双击的 exe 会以低完整性运行：Electron 沙箱初始化即崩溃、NSIS 写不了临时目录，
// 产物全部打不开。显式标为 Medium，之后写入的文件都会继承它。
if (process.platform === 'win32') {
  mkdirSync('desktop-dist', { recursive: true });
  try {
    execFileSync('icacls', ['desktop-dist', '/setintegritylevel', '(OI)(CI)M'], { stdio: 'pipe' });
  } catch (error) {
    console.warn('无法为 desktop-dist 设置 Medium 完整性标签：', error.message);
  }
}
