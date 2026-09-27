import { test, expect } from '@playwright/test';

const review = { timeAllocation: '', mistakes: '', improvements: '' };
const contests = Array.from({ length: 45 }, (_, index) => {
  const id = `abc${String(500 - index).padStart(3, '0')}`;
  const year = 2026 - Math.floor(index / 15);
  return {
    source: 'atcoder',
    key: `atcoder:${id}`,
    id,
    name: `AtCoder Beginner Contest ${500 - index}`,
    startTimeSeconds: Math.floor(new Date(`${year}-09-01T12:00:00Z`).getTime() / 1000) - index * 3600,
    types: ['ATCODER_OFFICIAL'],
    review: { ...review },
    inContestSolved: index ? 0 : 2,
    analysisStatus: '已分析',
    analysisScore: null,
    officialPerformance: index ? null : 900,
    officialPlace: index + 1,
    officialRated: index === 0,
  };
});

test('large contest list keeps filters, page and report selection; navigation protects notes', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'pages', 'Local API fixture supplies the large contest list.');
  await page.route('**/api/review/contests', (route) => route.fulfill({ json: contests }));
  await page.route('**/api/atcoder/contests/*/analysis', (route) => {
    const id = route.request().url().split('/').at(-2)!;
    const index = contests.findIndex((c) => c.id === id);
    return route.fulfill({
      json: {
        contestId: id,
        fetchedAt: '2026-09-27T00:00:00.000Z',
        source: 'atcoder-problems',
        complete: true,
        inContest: [],
        afterContest: [],
        solved: index ? 0 : 2,
        failures: 0,
        firstAcMinutes: index ? null : 18,
        advice: [],
        windowAvailable: true,
        official: {
          place: index + 1,
          performance: index ? null : 900,
          oldRating: 400,
          newRating: index ? 400 : 450,
          rated: index === 0,
          endTime: '2026-09-01T14:00:00.000Z',
          sourceUrl: `https://atcoder.jp/users/example/history`,
          fetchedAt: '2026-09-27T00:00:00.000Z',
        },
      },
    });
  });
  await page.route('**/api/atcoder/contests/*/review', async (route) =>
    route.fulfill({ json: route.request().postDataJSON() }),
  );
  await page.goto('/contests');
  await expect(page.locator('.contest-item')).toHaveCount(20);
  await expect(page.getByText('找到 45 场')).toBeVisible();
  await page.getByRole('button', { name: '下一页比赛' }).click();
  await expect(page.locator('.contest-item')).toHaveCount(20);
  await expect(page).toHaveURL(/page=2/);
  await page.locator('.contest-item').first().click();
  await expect(page.locator('.contest-editor h2')).toHaveText(contests[20].name);
  await expect(page).toHaveURL(/contest=atcoder(?::|%3A)abc480/);
  await page.reload();
  await expect(page.locator('.contest-editor h2')).toHaveText(contests[20].name);
  await expect(page.getByText('第 2 / 3 页')).toBeVisible();

  await page.getByLabel('关键失误', { exact: true }).fill('未保存');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '下一场' }).click();
  await expect(page.locator('.contest-editor h2')).toHaveText(contests[20].name);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '下一场' }).click();
  await expect(page.locator('.contest-editor h2')).toHaveText(contests[21].name);
  await expect(page.locator('.report-score .score-value')).toHaveText('—');
  await expect(page.locator('.report-score')).toContainText('非评级场次，官方历史未提供 Performance');

  await page.getByLabel('比赛年份').selectOption('2025');
  await expect(page.getByText('找到 15 场')).toBeVisible();
  await expect(page).not.toHaveURL(/page=2/);
  await page.getByLabel('搜索比赛').fill('abc475');
  await expect(page.getByText('找到 1 场')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('比赛年份')).toHaveValue('2025');
  await expect(page.getByLabel('搜索比赛')).toHaveValue('abc475');
  await expect(page.getByText('找到 1 场')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.contest-editor')).toBeVisible();
  await page.getByRole('button', { name: '返回比赛列表' }).click();
  await expect(page.locator('.contest-list')).toBeVisible();
  await page.locator('.contest-item').first().click();
  await expect(page.locator('.contest-editor')).toBeVisible();
  await expect(page.locator('.contest-list')).toBeHidden();
  await page.getByRole('button', { name: '返回比赛列表' }).click();
  await expect(page.locator('.contest-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
