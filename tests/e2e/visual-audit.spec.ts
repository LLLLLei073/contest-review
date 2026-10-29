import { test, expect } from '@playwright/test';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
import { mockCodeforces } from '../browser-fixture';

test('all workbench pages fit three viewports and graph exposes nodes beyond the drawing cap', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const pages = info.project.name === 'pages';
  const target = (path: string) => (pages ? './#' + path : path);
  const store = new Store(':memory:');
  store.activate('visual_audit');
  for (let i = 0; i < 45; i++)
    store.manualProblem('visual_audit', {
      contestId: 9700 + i,
      index: 'A',
      name: `Audit problem ${i}`,
      rating: 1200,
      tags: ['binary search'],
    });
  store.saveWeeklyGoal({ mode: 'focus', categories: ['搜索与技巧'] });
  store.markRecentChecked('visual_audit');
  const backup = store.backup();
  store.close();
  if (pages) await mockCodeforces(page);
  await page.goto(target('/settings?view=backup'));
  await page
    .getByLabel('选择备份文件')
    .setInputFiles({
      name: 'audit.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('visual_audit');
  await page.goto(target('/knowledge?view=graph'));
  const table = page.getByRole('table').filter({ has: page.locator('caption', { hasText: '完整节点列表' }) });
  await expect.poll(() => table.locator('tbody tr').count()).toBeGreaterThan(40);
  await expect(page.getByRole('img', { name: '算法知识关系图' }).locator('g')).toHaveCount(40);
  await page.getByLabel('检索图谱节点').fill('Audit problem 44');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await table.getByRole('button', { name: '展开' }).click();
  await expect(page.getByText(/当前邻域：Audit problem 44/)).toBeVisible();
  const routes = [
    '/',
    '/problems',
    '/problems/9700%3AA',
    '/contests',
    '/simulation',
    '/statistics',
    '/knowledge',
    '/growth',
    '/companion',
    '/settings',
  ];
  for (const [index, route] of routes.entries()) {
    await page.goto(target(route));
    await expect(page.locator('h1').first()).toBeVisible();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const theme of ['light', 'dark']) {
        const html = page.locator('html');
        if ((await html.getAttribute('data-theme')) !== theme)
          await page
            .getByRole('button', { name: theme === 'light' ? '切换为明亮模式' : '切换为深色模式' })
            .click();
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), {
            message: `${route} ${width} ${theme} must not overflow`,
          })
          .toBeLessThanOrEqual(1);
        await page.screenshot({
          path: info.outputPath(`page-${index}-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  }
});
