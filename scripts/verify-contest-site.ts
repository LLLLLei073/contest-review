import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/store';
const site = process.argv[2];
if (!site || !site.startsWith('https://'))
  throw new Error('Usage: tsx scripts/verify-contest-site.ts <https-site>');
// The public participant and contest were independently verified by check-contest-analysis.ts.
// Start without cached reports: all analysis data must be fetched by the deployed browser application.
const store = new Store(':memory:');
store.activate('harshit_singhal');
store.put('contests', 'harshit_singhal', '2000', { id: 2000, name: 'Codeforces 2000' });
const backup = store.backup();
store.close();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(site + '#/settings', { waitUntil: 'networkidle' });
  await page
    .getByLabel('选择备份文件')
    .setInputFiles({
      name: 'isolated-live-profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page.getByRole('button', { name: /Codeforces 2000/ }).click();
  await page.getByRole('button', { name: '刷新分析' }).click();
  await page.getByText('分析已更新', { exact: true }).waitFor({ timeout: 120000 });
  const score = await page.locator('.score-value').innerText();
  if (!/^90\s*\/\s*100$/.test(score)) throw new Error('Unexpected verified real-contest score: ' + score);
  await page.getByText(/个人榜单 #8340/).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Codeforces Round 966/ }).click();
  await page.locator('.score-value').filter({ hasText: '90' }).waitFor();
  if (errors.length) throw new Error(errors.join('; '));
  mkdirSync('test-results-pages', { recursive: true });
  await page.screenshot({ path: 'test-results-pages/live-contest-analysis.png', fullPage: true });
  const result = { site, score, rank: 8340, realCodeforces: true, reloadPersisted: true, errors };
  writeFileSync('test-results-pages/live-contest-analysis.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  await browser.close();
}
