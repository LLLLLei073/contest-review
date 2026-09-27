import { test, expect } from '@playwright/test';

test('Pages AtCoder-only flow keeps review, categories, report and backup in browser', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  let includeAc = false;
  await page.route('https://kenkoooo.com/atcoder/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname.endsWith('/user/submissions')) {
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
      ];
    else body = { abc777_a: { difficulty: 850 } };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });
  });
  await page.goto('./#/settings');
  await page.getByLabel('AtCoder 用户名').fill('alice');
  await page.getByRole('button', { name: '绑定 AtCoder' }).click();
  await page.getByRole('button', { name: '首次同步', exact: true }).click();
  await expect(page.getByText('已从公开提交验证该用户名')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.settings-card').first()).toContainText('同步完成', { timeout: 20000 });
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
  await expect(page.getByText('赛时分题时间线')).toBeVisible();
  await expect(page.getByText('无法核实正式或虚拟参赛身份')).toBeVisible();
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
  expect(backup.version).toBe(5);
  expect(backup.activeAtcoder).toBe('alice');
});
