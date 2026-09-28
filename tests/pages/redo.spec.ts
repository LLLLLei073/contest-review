import { test, expect } from '@playwright/test';
import { mockCodeforces } from '../browser-fixture';
import { fixtureSubmissions } from '../cf-fixtures';

test('Pages confirms same-day AC before reflection and waits for subjective evaluation', async ({ page }) => {
  await mockCodeforces(page);
  let includeRedo = false;
  await page.route('https://codeforces.com/api/user.status**', async (route) => {
    const url = new URL(route.request().url());
    const todayAc = {
      ...fixtureSubmissions.find((s) => s.problem.contestId === 2000)!,
      id: 99999,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      verdict: 'OK',
      author: { participantType: 'PRACTICE' },
    };
    const all = includeRedo ? [todayAc, ...fixtureSubmissions] : fixtureSubmissions;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        status: 'OK',
        result: all.slice(
          Number(url.searchParams.get('from')) - 1,
          Number(url.searchParams.get('from')) - 1 + Number(url.searchParams.get('count')),
        ),
      }),
    });
  });
  await page.goto('./#/settings');
  await page.getByLabel('Codeforces Handle').fill('redo_tester');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.locator('.profile-chip')).toContainText('redo_tester');
  await page.getByRole('button', { name: '同步状态' }).click();
  await page.getByRole('button', { name: '开始首次同步' }).click();
  await expect(page.getByText('同步完成', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.getByText('Two Screens', { exact: true })).toBeVisible();
  includeRedo = true;
  await page.getByRole('button', { name: '检查提交' }).click();
  await expect(page.getByText('重做完成 · 待复盘')).toBeVisible();
  await page.getByRole('link', { name: '写复盘' }).first().click();
  await page.getByLabel('当时的思路', { exact: false }).fill('忽略了边界条件');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.getByText('重做完成 · 待评价')).toBeVisible();
  await page.getByRole('button', { name: '手动评价' }).click();
  await page.getByLabel('耗时（分钟）').fill('15');
  await page.getByRole('button', { name: '保存结果' }).click();
  await expect(page.getByText('今日 AC')).toBeVisible();
  await page.getByRole('link', { name: '查看笔记' }).first().click();
  await expect(page.locator('.stage-track .done')).toHaveCount(1);
});
