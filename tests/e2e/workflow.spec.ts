import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockCodeforces } from '../browser-fixture';
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'pages') await mockCodeforces(page);
});
test('complete local workflow with fixed Codeforces fixtures', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(testInfo.project.name === 'pages' ? './#/' : '/');
  await expect(page.getByRole('heading', { name: '今日题单' })).toBeVisible();
  await page.locator('.profile-chip').click();
  await page.getByLabel('Codeforces Handle').fill('review_tester');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.getByText('已绑定', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-chip')).toContainText('review_tester');
  await expect(page.getByRole('button', { name: '绑定用户名' })).toBeEnabled();
  await page.getByRole('button', { name: '同步状态' }).click();
  await page.getByRole('button', { name: '开始首次同步' }).click();
  await expect(page.getByText('同步完成', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await page.getByRole('button', { name: '选择目标' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /数学/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('Two Screens', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await expect(page.getByRole('link', { name: '2000C Two Screens', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '2000C Two Screens', exact: true }).click();
  await page.getByLabel('耗时（分钟）').fill('18');
  await page.getByLabel('新的发现').fill('先证明，再实现。');
  await page.getByRole('button', { name: '记录尝试', exact: true }).click();
  await expect(page.getByRole('button', { name: /重做历史 1/ })).toBeVisible();
  await page.getByLabel('当时的思路', { exact: false }).fill('只考虑了单个字符串。');
  await page.getByLabel('边界遗漏', { exact: true }).check();
  await page
    .getByLabel('正确解法', { exact: false })
    .fill(
      '## 关键观察\n寻找公共前缀，复杂度为 $O(n)$。\n\n$$\nf(n)=n+1\n$$\n\n<img src=x onerror="alert(1)">',
    );
  await page.getByLabel('代码留档', { exact: false }).fill('int main() { return 0; }');
  await page.getByRole('button', { name: '预览笔记' }).click();
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.markdown img')).toHaveCount(0);
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByText('复盘已保存')).toBeVisible();
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await expect(page.locator('.daily-panel').nth(1).locator('.daily-task')).toHaveCount(5);
  await page.locator('.recommendation-detail summary').first().click();
  await expect(page.locator('.recommendation-detail').first()).toContainText('CF 官方 Rating 1447');
  await expect(page.getByText('Two Screens', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('progressbar', { name: '今日复习进度' })).toHaveAttribute('aria-valuenow', '1');
  await expect(page.locator('.daily-panel').first().locator('.daily-task').first()).toHaveAttribute(
    'data-phase',
    'done',
  );
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '查看笔记' }).first().click();
  await page.getByRole('button', { name: /重做历史/ }).click();
  await expect(page.getByText('先证明，再实现。')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /重做历史/ }).click();
  await expect(page.getByText('先证明，再实现。')).toBeVisible();
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await page.getByRole('button', { name: /Codeforces Round 980/ }).click();
  await page.getByRole('button', { name: '补充笔记' }).click();
  await page.getByLabel('关键失误', { exact: true }).fill('没有先想清楚边界。');
  await page.getByLabel('下一场的改进').fill('留十分钟检查边界。');
  await page.getByRole('button', { name: '保存比赛复盘' }).click();
  await expect(page.getByText('比赛复盘已保存')).toBeVisible();
  await page.getByRole('link', { name: '训练统计', exact: true }).click();
  await expect(page.getByRole('heading', { name: '算法领域掌握度' })).toBeVisible();
  await expect(page.locator('.mastery-row')).toHaveCount(8);
  await page.getByRole('button', { name: '练习趋势' }).click();
  await expect(page.getByRole('heading', { name: '最近 14 天的重做记录' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('statistics.png'), fullPage: true });
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const backup = JSON.parse(readFileSync(path!, 'utf8'));
  expect(backup.format).toBe('contest-review');
  expect(backup.version).toBe(8);
  expect(
    backup.tables.catalog_cache.filter((row: { profile: string }) => row.profile === 'review_tester'),
  ).toHaveLength(1);
  expect(backup.tables.attempts).toHaveLength(1);
  await page.getByLabel('选择备份文件').setInputFiles(path!);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.getByText('备份恢复完成')).toBeVisible();
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await page.getByRole('link', { name: '2000C Two Screens', exact: true }).click();
  await expect(page.getByLabel('当时的思路', { exact: false })).toHaveValue('只考虑了单个字符串。');
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: '错题库', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('manual problems, ignore restore, filters and invalid backup preserve data across profiles', async ({
  page,
}, testInfo) => {
  await page.goto(testInfo.project.name === 'pages' ? './#/settings' : '/settings');
  await page.getByRole('button', { name: '跳过动画' }).click();
  await page.getByLabel('Codeforces Handle').fill('isolation_reference');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.locator('.profile-chip')).toContainText('isolation_reference');
  await expect(page.getByRole('button', { name: '绑定用户名' })).toBeEnabled();
  await page.getByRole('button', { name: '同步状态' }).click();
  await page.getByRole('button', { name: '开始首次同步' }).click();
  await expect(page.getByText('同步完成', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '账号连接' }).click();
  await page.getByLabel('Codeforces Handle').fill('secondary');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.locator('.profile-chip')).toContainText('secondary');
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await expect(page.getByText('这里还没有匹配的题目')).toBeVisible();
  await page.getByRole('button', { name: '手动添加' }).click();
  await page.getByLabel('比赛 ID').fill('2100');
  await page.getByLabel('题目编号').fill('D');
  await page.getByLabel('题目名称').fill('My unsolved problem');
  await page.getByLabel('难度（选填）').fill('1800');
  await page.getByLabel('算法标签（英文逗号分隔）').fill('dp, graphs');
  await page.getByRole('button', { name: '加入错题库' }).click();
  await expect(page.getByRole('heading', { name: 'My unsolved problem' })).toBeVisible();
  await page.getByRole('button', { name: '暂时忽略此题' }).click();
  await expect(page.getByRole('button', { name: '恢复此题' })).toBeVisible();
  await page.getByRole('link', { name: '返回错题库' }).click();
  await expect(page.getByText('这里还没有匹配的题目')).toBeVisible();
  await page.getByRole('button', { name: '已忽略', exact: true }).click();
  await page.getByRole('link', { name: '2100D My unsolved problem', exact: true }).click();
  await page.getByRole('button', { name: '恢复此题' }).click();
  await page.getByRole('link', { name: '返回错题库' }).click();
  await page.locator('.advanced-filters summary').click();
  await page.getByLabel('算法标签', { exact: true }).selectOption('dp');
  await page.getByLabel('最低难度').fill('1900');
  await expect(page.getByText('这里还没有匹配的题目')).toBeVisible();
  await page.getByLabel('最低难度').fill('1700');
  await expect(page.getByRole('link', { name: '2100D My unsolved problem', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"contest-review","version":999}'),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.getByRole('alert')).toContainText('输入格式不正确');
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await expect(page.getByRole('link', { name: '2100D My unsolved problem', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '设置与数据', exact: true }).click();
  await page.getByRole('button', { name: '账号连接' }).click();
  await page.getByRole('button', { name: 'isolation_reference', exact: true }).click();
  await expect(page.locator('.profile-chip')).toContainText('isolation_reference');
  await page.getByRole('link', { name: '错题库', exact: true }).click();
  await expect(page.getByRole('link', { name: '2000C Two Screens', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '2100D My unsolved problem', exact: true })).toHaveCount(0);
});
