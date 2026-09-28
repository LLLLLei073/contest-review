import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Store } from '../../server/store';
import { fixtureSubmissions } from '../cf-fixtures';

test('legacy backups, IndexedDB persistence, offline reload and tab ownership', async ({ page, context }) => {
  const original = new Store(':memory:');
  original.activate('offline_tester');
  original.ingest('offline_tester', fixtureSubmissions);
  const backup = original.backup();
  backup.version = 1;
  delete backup.tables.analysis_cache;
  delete backup.tables.catalog_cache;
  delete backup.tables.daily_plans;
  delete backup.tables.training_meta;
  original.close();
  const backendRequests: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin === 'http://127.0.0.1:4173' && new URL(r.url()).pathname.startsWith('/api/'))
      backendRequests.push(r.url());
  });
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'local-v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('offline_tester');
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await page.getByRole('link', { name: '2000C Two Screens', exact: true }).click();
  await page.getByLabel('当时的思路', { exact: false }).fill('浏览器持久化验证');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByText('复盘已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('当时的思路', { exact: false })).toHaveValue('浏览器持久化验证');
  const second = await context.newPage();
  await second.goto('./#/');
  await expect(second.getByText(/另一个标签页正在使用此错题库/).first()).toBeVisible();
  await second.close();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('当时的思路', { exact: false })).toHaveValue('浏览器持久化验证');
  await page.getByLabel('当时的思路', { exact: false }).fill('离线修改已保存');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByText('复盘已保存', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await dl;
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported.tables.reviews.find((r: { key: string }) => r.key === '2000:C').value.wrongIdea).toBe(
    '离线修改已保存',
  );
  const before = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载最近一次恢复前的备份' }).click();
  const previous = await before;
  expect(JSON.parse(readFileSync((await previous.path())!, 'utf8')).profiles).toHaveLength(0);
  expect(backendRequests).toEqual([]);
  await context.setOffline(false);
});
