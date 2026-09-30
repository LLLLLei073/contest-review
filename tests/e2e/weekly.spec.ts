import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import type { CFSubmission } from '../../shared/domain';

test('weekly goal, recommendation, upsolve, statistics and CF simulation survive browser navigation', async ({
  page,
}, info) => {
  const store = new Store(':memory:');
  store.activate('weekly_tester');
  const submission: CFSubmission = {
    id: 41001,
    contestId: 4100,
    creationTimeSeconds: 1700000100,
    problem: { contestId: 4100, index: 'A', name: 'Old A', rating: 1100, tags: ['math'] },
    verdict: 'WRONG_ANSWER',
    programmingLanguage: 'C++',
    author: { participantType: 'CONTESTANT' },
  };
  store.ingest('weekly_tester', [submission]);
  store.enrich(
    'weekly_tester',
    [
      {
        id: 4100,
        name: 'Weekly Fixture Round',
        startTimeSeconds: 1700000000,
        durationSeconds: 7200,
        phase: 'FINISHED',
        type: 'CF',
      },
    ],
    [],
    [
      submission.problem,
      { contestId: 4100, index: 'B', name: 'Old B', rating: 1200, tags: ['dp'] },
      ...Array.from({ length: 12 }, (_, i) => ({
        contestId: 4200 + i,
        index: 'A',
        name: `Fresh ${i}`,
        rating: i % 4 < 2 ? 1000 + (i % 2) * 100 : 1500 + (i % 2) * 100,
        tags: i < 5 ? ['math'] : ['dp'],
      })),
    ],
  );
  const backup = store.backup();
  store.close();
  const base = info.project.name === 'pages' ? './#/' : '/';
  await page.goto(base + 'settings');
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'weekly.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('weekly_tester');
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.getByText('请选择本周方向')).toBeVisible();
  await expect(page.locator('.daily-panel').nth(1).locator('.daily-task')).toHaveCount(0);
  await page.getByRole('button', { name: '选择目标' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /数学/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await expect(page.locator('.daily-panel').nth(1).locator('.daily-task')).toHaveCount(5);
  await page.locator('.recommendation-detail summary').first().click();
  await expect(page.locator('.recommendation-detail').first().locator('p')).toContainText('本周目标');
  expect(
    (await page.locator('.daily-panel').nth(1).locator('.daily-task').last().boundingBox())!.y,
  ).toBeLessThan(1000);
  await page.screenshot({ path: info.outputPath('weekly-dashboard-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page
    .getByRole('button', { name: /Weekly Fixture Round/ })
    .first()
    .click();
  await page.getByRole('button', { name: '未 AC 题加入补题清单' }).click();
  await page.getByRole('link', { name: '训练统计', exact: true }).click();
  await expect(page.locator('.statistics-metrics')).toBeVisible();
  expect((await page.locator('.mastery-panel').boundingBox())!.y).toBeLessThan(1000);
  await page.getByRole('button', { name: /赛后补题/ }).click();
  await expect(page.getByRole('heading', { name: '赛后补题清单' })).toBeVisible();
  await expect(page.getByText('Old B', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '数据健康' }).click();
  await expect(page.getByRole('heading', { name: '数据健康' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('weekly-statistics-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page.getByRole('link', { name: 'CF 模拟赛', exact: true }).click();
  await page.getByLabel('搜索模拟赛').fill('Weekly Fixture');
  await page.getByRole('button', { name: /Weekly Fixture Round · #4100/ }).click();
  await expect(page.getByText(/剩余 \d+:/)).toBeVisible();
  await page.getByRole('button', { name: '手记 AC' }).first().click();
  await page.locator('.report-deep-dive summary').click();
  await expect(page.getByText(/手动记录/).last()).toBeVisible();
  await page.reload();
  await page.locator('.report-deep-dive summary').click();
  await expect(page.getByText(/手动记录/).last()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.sidebar nav').getByRole('link', { name: '设置与数据' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('weekly-simulation-mobile.png'), fullPage: true });
});

test('weekly goal scene keeps today fixed and supports cancel, keyboard and reduced motion', async ({
  page,
}, info) => {
  const store = new Store(':memory:');
  store.activate('goal_scene_tester');
  store.enrich(
    'goal_scene_tester',
    [],
    [],
    Array.from({ length: 24 }, (_, index) => ({
      contestId: 5200 + index,
      index: 'A',
      name: `Goal Scene ${index}`,
      rating: index % 4 < 2 ? 1000 + (index % 2) * 100 : 1500 + (index % 2) * 100,
      tags: index % 8 < 4 ? ['math'] : ['dp'],
    })),
  );
  const backup = store.backup();
  store.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(info.project.name === 'pages' ? './#/settings' : '/settings');
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'goal-scene.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await page.getByRole('link', { name: '今日题单', exact: true }).click();

  await page.getByRole('button', { name: '选择目标' }).click();
  const dialog = page.getByRole('dialog', { name: /这一周/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确定' })).toBeDisabled();
  await expect(dialog.locator('.goal-scene__word')).toHaveCount(8);
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await page.screenshot({ path: info.outputPath('goal-scene-desktop.png') });
  await dialog.getByRole('button', { name: /数学/ }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('button', { name: /数学/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '选择目标' })).toBeFocused();

  await page.getByRole('button', { name: '选择目标' }).click();
  await expect(dialog.getByRole('button', { name: /数学/ })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: /数学/ }).click();
  if (info.project.name !== 'pages') {
    await page.route('**/api/training/weekly', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '暂时不可用' }),
      }),
    );
    await dialog.getByRole('button', { name: '确定' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.unroute('**/api/training/weekly');
  }
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.daily-panel').nth(1).locator('.daily-task')).toHaveCount(5);
  const original = await page.locator('.daily-panel').nth(1).locator('.daily-task strong').allTextContents();

  await page.getByRole('button', { name: '调整目标' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('goal-scene-mobile.png') });
  await expect(dialog.getByRole('button', { name: /数学/ })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '均衡多个领域' }).click();
  await expect(dialog.getByRole('button', { name: '确定' })).toBeDisabled();
  await dialog.getByRole('button', { name: /动态规划/ }).click();
  await expect(dialog.getByRole('button', { name: '确定' })).toBeEnabled();
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.weekly-goal')).toContainText('均衡');
  await expect
    .poll(() => page.locator('.daily-panel').nth(1).locator('.daily-task strong').allTextContents())
    .toEqual(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
