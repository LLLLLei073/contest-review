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
        rating: 900 + i * 100,
        tags: i < 5 ? ['math'] : ['dp'],
      })),
    ],
  );
  const backup = store.backup();
  store.close();
  const base = info.project.name === 'pages' ? './#/' : '/';
  await page.goto(base + 'settings');
  await page
    .getByLabel('选择备份文件')
    .setInputFiles({
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
  await page.getByLabel('数学', { exact: true }).check();
  await page.getByRole('button', { name: '保存本周目标' }).click();
  await expect(page.locator('.daily-panel').nth(1).locator('.daily-task')).toHaveCount(5);
  await expect(page.getByText(/推荐原因：本周目标/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('weekly-dashboard-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page
    .getByRole('button', { name: /Weekly Fixture Round/ })
    .first()
    .click();
  await page.getByRole('button', { name: '未 AC 题加入补题清单' }).click();
  await page.getByRole('link', { name: '训练统计', exact: true }).click();
  await expect(page.getByRole('heading', { name: '赛后补题清单' })).toBeVisible();
  await expect(page.getByText('Old B', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '数据健康' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('weekly-statistics-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'CF 模拟赛', exact: true }).click();
  await page.getByLabel('搜索模拟赛').fill('Weekly Fixture');
  await page.getByRole('button', { name: /Weekly Fixture Round · #4100/ }).click();
  await expect(page.getByText(/剩余 \d+:/)).toBeVisible();
  await page.getByRole('button', { name: '手记 AC' }).first().click();
  await expect(page.getByText(/手动记录/).last()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/手动记录/).last()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('weekly-simulation-mobile.png'), fullPage: true });
});
