import { test, expect, type Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('Pages AtCoder-only flow keeps review, categories, report and backup in browser', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  let includeAc = false;
  let mirrorResources = 0;
  const handleRoute = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/atcoder-resources/')) mirrorResources++;
    let body: unknown;
    if (url.pathname.endsWith('/history/json'))
      body = [
        {
          IsRated: true,
          Place: 123,
          OldRating: 400,
          NewRating: 450,
          Performance: 900,
          ContestScreenName: 'abc777.contest.atcoder.jp',
          ContestName: 'ABC Browser Fixture',
          EndTime: new Date((now + 1800) * 1000).toISOString(),
        },
        {
          IsRated: false,
          Place: 7,
          OldRating: 450,
          NewRating: 450,
          Performance: 0,
          ContestScreenName: 'abc778.contest.atcoder.jp',
          ContestName: 'Zero Submission Fixture',
          EndTime: new Date((now - 20000) * 1000).toISOString(),
        },
      ];
    else if (url.pathname.endsWith('/user/submissions')) {
      const all = [
        {
          id: 9001,
          epoch_second: now - 1200,
          problem_id: 'abc777_a',
          contest_id: 'abc777',
          user_id: 'alice',
          language: 'C++',
          result: 'WA',
        },
        ...(includeAc
          ? [
              {
                id: 9002,
                epoch_second: now - 100,
                problem_id: 'abc777_a',
                contest_id: 'abc777',
                user_id: 'alice',
                language: 'C++',
                result: 'AC',
              },
            ]
          : []),
      ];
      body = all.filter((s) => s.epoch_second >= Number(url.searchParams.get('from_second') ?? 0));
    } else if (url.pathname.endsWith('/problems.json'))
      body = [{ id: 'abc777_a', contest_id: 'abc777', problem_index: 'A', name: 'Review A' }];
    else if (url.pathname.endsWith('/contests.json'))
      body = [
        { id: 'abc777', start_epoch_second: now - 1800, duration_second: 3600, title: 'ABC Browser Fixture' },
        {
          id: 'abc778',
          start_epoch_second: now - 24000,
          duration_second: 4000,
          title: 'Zero Submission Fixture',
        },
      ];
    else body = { abc777_a: { difficulty: 850 } };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  };
  await page.route('https://kenkoooo.com/atcoder/**', handleRoute);
  await page.route('**/atcoder-resources/*.json', handleRoute);
  await page.goto('./#/settings');
  await page.getByLabel('AtCoder 用户名').fill('alice');
  await page.getByRole('button', { name: '绑定 AtCoder' }).click();
  await page.getByRole('button', { name: '首次同步', exact: true }).click();
  await expect(page.getByText('已从官方比赛历史验证该用户名')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.settings-card').first()).toContainText('同步完成', { timeout: 20000 });
  expect(mirrorResources).toBe(3);
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.getByText('Review A', { exact: true })).toBeVisible();
  await expect(page.getByText('新知题仅从 Codeforces 选择。')).toBeVisible();
  await page.getByRole('link', { name: '查看笔记' }).first().click();
  await expect(page.getByText('ATCODER / abc777_a')).toBeVisible();
  await page.getByText('数学', { exact: true }).first().click();
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.getByRole('link', { name: '训练统计', exact: true }).click();
  await page.getByLabel('统计来源').selectOption('atcoder');
  await expect(page.locator('.mastery-radar')).toBeVisible();
  includeAc = true;
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  await page.getByRole('button', { name: '增量同步' }).click();
  await expect(page.locator('.settings-card').first()).toContainText('正在同步', { timeout: 10000 });
  await expect(page.locator('.settings-card').first()).toContainText('同步完成', { timeout: 20000 });
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.getByText('重做完成 · 待复盘')).toBeVisible();
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page.getByRole('button', { name: /ABC Browser Fixture/ }).click();
  await expect(page.getByRole('button', { name: /ABC Browser Fixture/ })).toContainText('AtCoder 正式参赛');
  await expect(page.locator('.report-score')).toContainText('AtCoder 官方 Performance');
  await expect(page.locator('.report-score .score-value')).toHaveText('900');
  await expect(page.locator('.report-context')).toContainText('官方排名 #123');
  await expect(page.getByText('赛时分题时间线')).toBeVisible();
  await page.getByRole('button', { name: /Zero Submission Fixture/ }).click();
  await expect(page.getByText('官方参赛记录已确认；没有已同步的赛时提交。')).toBeVisible();
  await expect(page.locator('.report-score .score-value')).toHaveText('—');
  await expect(page.locator('.report-score')).toContainText('非评级场次，官方历史未提供 Performance');
  await expect(page).toHaveURL(/contest=atcoder/);
  await page.getByRole('button', { name: 'AtCoder', exact: true }).click();
  await expect(page).toHaveURL(/contest=atcoder/);
  await page.getByLabel('搜索比赛').fill('abc777');
  await expect(page.getByText('找到 1 场')).toBeVisible();
  await expect(page).toHaveURL(/contest=atcoder/);
  await page.reload();
  await expect(page.getByLabel('搜索比赛')).toHaveValue('abc777');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.contest-editor')).toBeVisible();
  await page.getByRole('button', { name: '返回比赛列表' }).click();
  await expect(page.locator('.contest-list')).toBeVisible();
  await page.locator('.contest-item').first().click();
  await expect(page.locator('.contest-editor')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  const backup = JSON.parse(
    await (
      await downloaded
    )
      .path()
      .then(async (path) => (await import('node:fs/promises')).readFile(path, 'utf8')),
  );
  expect(backup.version).toBe(7);
  expect(backup.activeAtcoder).toBe('alice');
});
