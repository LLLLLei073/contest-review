import { test, expect } from '@playwright/test';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
test('offline-capable learning path and budget plan preview, apply, replace and revert preserve today', async ({
  page,
}, info) => {
  const store = new Store(':memory:');
  store.activate('planning_browser');
  store.enrich(
    'planning_browser',
    [],
    [],
    Array.from({ length: 24 }, (_, i) => ({
      contestId: 6500 + i,
      index: 'A',
      name: `Planning ${i}`,
      rating: 1100,
      tags: i % 3 ? ['implementation'] : ['binary search'],
    })),
  );
  const tomorrow = new Date(Date.now() + 86400000);
  store.saveWeeklyGoal({ mode: 'focus', categories: ['实现与模拟'] });
  store.saveWeeklyGoal({ mode: 'focus', categories: ['实现与模拟'] }, tomorrow);
  store.combinedTrainingDay();
  store.markRecentChecked('planning_browser');
  const backup = store.backup();
  store.close();
  const base = info.project.name === 'pages' ? './#/' : '/';
  await page.goto(base + 'settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'planning.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('planning_browser');
  await page.getByRole('link', { name: '今日训练', exact: true }).click();
  const original = await page.locator('.daily-panel').nth(1).locator('.daily-task strong').allTextContents();
  await page.getByRole('button', { name: '学习路径', exact: true }).click();
  await page.getByLabel('实现与模拟', { exact: true }).check();
  await page.getByLabel('二分答案', { exact: true }).check();
  await page.getByRole('button', { name: '保存学习方向与时间' }).click();
  await expect(page.locator('.path-steps>li')).toHaveCount(2);
  await expect(page.locator('.path-steps>li').first()).toContainText('实现与模拟');
  await page.getByLabel('每天可用时间').selectOption('15');
  await page.getByRole('button', { name: '预览未来计划' }).click();
  await expect(page.getByRole('alert')).toContainText('至少需要 70 分钟');
  await expect(page.getByRole('button', { name: '确认采用此计划' })).toBeDisabled();
  await page.getByLabel('每天可用时间').selectOption('90');
  await page.getByRole('button', { name: '预览未来计划' }).click();
  await expect(page.getByRole('button', { name: '确认采用此计划' })).toBeEnabled();
  const selected = await page.locator('.planned-tasks strong').allTextContents();
  expect(selected).toHaveLength(2);
  await page.getByRole('button', { name: '换一道并重新校验' }).first().click();
  await expect.poll(() => page.locator('.planned-tasks strong').allTextContents()).not.toContain(selected[0]);
  await page.getByRole('button', { name: '确认采用此计划' }).click();
  await expect(page.getByRole('button', { name: '撤回此计划' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('learning-path-plan-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '撤回此计划' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已恢复变更前的安排' })).toBeVisible();
  await page.getByRole('button', { name: '今日题单', exact: true }).click();
  await expect
    .poll(() => page.locator('.daily-panel').nth(1).locator('.daily-task strong').allTextContents())
    .toEqual(original);
  await page.getByRole('button', { name: '学习路径', exact: true }).click();
  await page.reload();
  await expect(page.locator('.path-steps>li')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '切换为深色模式' }).click();
  await page.screenshot({ path: info.outputPath('learning-path-dark-mobile.png'), fullPage: true });
});
