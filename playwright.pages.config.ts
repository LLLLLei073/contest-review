import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/*.spec.ts', 'pages/*.spec.ts'],
  // 视觉截图用例依赖本地工程的备份恢复与确定性 fixture，离线 pages 工程不执行。
  testIgnore: ['**/visual-program.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  outputDir: 'test-results-pages',
  projects: [{ name: 'pages' }],
  use: {
    baseURL: 'http://127.0.0.1:4173/contest-review/',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --mode pages --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/contest-review/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
