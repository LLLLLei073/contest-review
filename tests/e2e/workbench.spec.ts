import { test, expect } from '@playwright/test';

test('workspace appearance persists and command search supports keyboard, focus and mobile navigation', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await page.goto(pages ? './#/settings?view=backup' : '/settings?view=backup');
  await expect(page.getByRole('heading', { name: '备份与恢复' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeHidden();
  await page.getByRole('button', { name: '账号连接', exact: true }).click();
  await expect(page.getByRole('heading', { name: '备份与恢复' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeHidden();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('link', { name: '比赛复盘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '赛后补题清单' })).toBeHidden();
  await page.getByRole('button', { name: /赛后补题/ }).click();
  await expect(page.getByRole('heading', { name: '赛后补题清单' })).toBeVisible();
  await page.getByRole('button', { name: '比赛报告', exact: true }).click();
  await expect(page.getByRole('heading', { name: '赛后补题清单' })).toBeHidden();
  await page.getByRole('link', { name: '今日训练', exact: true }).click();
  await page.getByRole('button', { name: '次日计划', exact: true }).click();
  await expect(page.locator('.learning-activity')).toBeVisible();
  await page.getByRole('button', { name: '今日题单', exact: true }).click();
  await expect(page.locator('.learning-activity')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换为深色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换为明亮模式' }).click();
  const trigger = page.getByRole('button', { name: '打开快捷操作' });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: '搜索页面与操作' });
  await expect(search).toBeFocused();
  await search.fill('没有这个操作');
  await expect(page.getByText('没有匹配的操作，试试“复习”或“备份”。')).toBeVisible();
  await search.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await search.fill('错题库');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: /^错题库/, level: 1 })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '想从哪里继续？' })).not.toBeVisible();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveCount(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`workbench-light-${width}.png`), fullPage: true });
  }
  await trigger.click();
  await search.fill('备份');
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: '备份与恢复' })).toBeVisible();
  await page.getByRole('button', { name: '切换为深色模式' }).click();
  await page.screenshot({ path: info.outputPath('workbench-dark-390.png'), fullPage: true });
});
