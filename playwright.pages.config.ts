import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/*.spec.ts', 'pages/*.spec.ts'],
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
    command: 'npm run preview:pages',
    url: 'http://127.0.0.1:4173/contest-review/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
