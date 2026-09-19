import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Store } from '../../server/store';
import { fixtureInput } from '../analysis-fixtures';
import { mockCodeforces } from '../browser-fixture';

test('automatic report, evidence, cache reload, notes and backup compatibility', async ({
  page,
  context,
}, info) => {
  const isPages = info.project.name === 'pages';
  if (isPages) await mockCodeforces(page);
  const data = fixtureInput(),
    s = new Store(':memory:');
  s.activate('tester');
  s.ingest('tester', data.submissions);
  s.enrich(
    'tester',
    data.contests,
    data.contests.flatMap((c) => (c.rating ? [c.rating] : [])),
    data.problems,
  );
  s.put('jobs', 'tester', 'fixture-full', {
    id: 'fixture-full',
    handle: 'tester',
    mode: 'full',
    status: 'completed',
    processed: 9,
    cursor: 1,
    message: 'fixture',
    startedAt: '2026-09-19T00:00:00.000Z',
  });
  const backup = s.backup();
  s.close();
  backup.version = 1;
  delete backup.tables.analysis_cache;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(isPages ? './#/settings' : '/settings');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('tester');
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page
    .getByRole('button', { name: /Analysis Fixture Round/ })
    .first()
    .click();
  await expect(page.getByText('分析已更新', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.score-value')).toContainText('62');
  await expect(page.locator('.score-part').first()).toContainText('20 人');
  await expect(page.locator('.timeline-problem').nth(1)).toContainText('未尝试');
  await expect(page.locator('.advice-card').first()).toContainText('3 次失败');
  await page.getByLabel('关键失误', { exact: true }).fill('自动分析后的补充笔记');
  await page.getByRole('button', { name: '保存比赛复盘' }).click();
  await expect(page.getByText('比赛复盘已保存', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('analysis-desktop.png'), fullPage: true });
  await page.reload();
  await page
    .getByRole('button', { name: /Analysis Fixture Round/ })
    .first()
    .click();
  await expect(page.locator('.score-value')).toContainText('62');
  await expect(page.getByLabel('关键失误', { exact: true })).toHaveValue('自动分析后的补充笔记');
  if (isPages) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await page
      .getByRole('button', { name: /Analysis Fixture Round/ })
      .first()
      .click();
    await expect(page.locator('.score-value')).toContainText('62');
    await context.setOffline(false);
    // A refresh error must preserve the report and personal notes.
    await page.route('https://codeforces.com/api/contest.standings*', (r) =>
      r.fulfill({ status: 503, body: 'unavailable' }),
    );
    await page.getByRole('button', { name: '刷新分析' }).click();
    await expect(page.getByRole('status')).toContainText('HTTP 503', { timeout: 20000 });
    await expect(page.locator('.score-value')).toContainText('62');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('analysis-mobile.png'), fullPage: true });
  await page.locator('.profile-chip').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const path = (await (await downloaded).path())!;
  const result = JSON.parse(readFileSync(path, 'utf8'));
  expect(result.version).toBe(2);
  expect(result.tables.analysis_cache).toHaveLength(1);
  await page.getByLabel('选择备份文件').setInputFiles(path);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.getByText('备份恢复完成', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
