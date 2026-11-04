// Explicit smoke check: Electron uses a fresh temporary DATA_DIR, never the user's database.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtempSync, cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const directory = mkdtempSync(join(tmpdir(), 'review-desktop-smoke-'));
let app;
try {
  const env = { ...process.env, DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const runtime = join(directory, 'runtime');
  cpSync(resolve('node_modules/electron/dist'), runtime, { recursive: true });
  app = await electron.launch({
    executablePath: join(runtime, 'electron.exe'),
    args: [resolve('electron-dist/main.cjs'), '--user-data-dir=' + join(directory, 'electron')],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(new URL('/settings?view=backup', page.url()).href);
  await expect(page.getByRole('heading', { name: /桌面自动备份/ })).toBeVisible();
  await page.getByRole('button', { name: '立即自动备份', exact: true }).click();
  const automatic = join(directory, 'backups', 'automatic');
  const files = readdirSync(automatic).filter((n) => /^automatic-.*\.json$/.test(n));
  if (!files.length) throw new Error('No automatic backup written');
  const backup = readFileSync(join(automatic, files.at(-1)), 'utf8');
  await page
    .getByLabel('选择备份文件')
    .setInputFiles({ name: 'desktop-smoke.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
  await expect(page.getByRole('table', { name: '恢复前后数量对比' })).toBeVisible();
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
  await expect(page.getByText('备份恢复完成', { exact: true })).toBeVisible();
  if (!readdirSync(join(directory, 'backups')).some((n) => n.startsWith('before-restore-')))
    throw new Error('Missing safety backup');
  await app.close();
  app = undefined;
  console.log(
    'PASS: Electron startup, automatic backup, restore preview, restore safety copy and shutdown (isolated DATA_DIR).',
  );
} finally {
  if (app) await app.close();
  rmSync(directory, { recursive: true, force: true });
}
