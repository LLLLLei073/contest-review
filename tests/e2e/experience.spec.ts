import { test, expect, type Page } from '@playwright/test';
import { Store } from '../../server/store';

const url = (pages: boolean, path: string) => (pages ? './#' + path : path);
async function prepare(page: Page, pages: boolean) {
  const store = new Store(':memory:');
  store.activate('experience_tester');
  store.manualProblem('experience_tester', {
    contestId: 6000,
    index: 'A',
    name: 'Experience Fixture',
    rating: 1000,
    tags: ['math'],
  });
  const backup = store.backup();
  store.close();
  await page.goto(url(pages, '/settings?view=backup'));
  await page.locator('input[type=file]').setInputFiles({
    name: 'experience.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('experience_tester');
}

test('legacy destinations, explicit settings links, invalid sections and browser history', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  for (const [old, target] of [
    ['/knowledge?view=diagnosis&card=binary-search', '/statistics?view=diagnosis'],
    ['/knowledge?view=training', '/?view=training'],
    ['/knowledge?view=transfers', '/?view=transfers'],
    ['/statistics?view=upsolve&contest=cf%3A6000', '/contests?view=upsolve'],
    ['/statistics?view=health', '/settings?view=sync'],
  ]) {
    await page.goto(url(pages, old!));
    await expect
      .poll(() => {
        const location = new URL(page.url());
        const current = pages ? new URL(location.hash.slice(1), 'https://local.invalid') : location;
        return current.pathname + '?view=' + current.searchParams.get('view');
      })
      .toBe(target);
  }
  await page.goto(url(pages, '/settings?view=backup'));
  await page.goto(url(pages, '/settings?view=ai'));
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeVisible();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeVisible();
  await page.goto(url(pages, '/settings?view=unknown&platform=unknown'));
  await expect(page.getByLabel('Codeforces Handle')).toBeVisible();
  await expect(page).toHaveURL(/view=accounts/);
  await expect(page).toHaveURL(/platform=cf/);
  await page.goto(url(pages, '/knowledge?view=unknown'));
  await expect(page.getByRole('button', { name: '知识与经验', exact: true })).toHaveClass(/active/);
});

test('problem notes and shared assistant context survive tool switches and history', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  await page.goto(url(pages, '/problems/6000%3AA'));
  await page.getByLabel('当时的思路', { exact: false }).fill('未保存的思路');
  await page.getByRole('button', { name: '解题助手', exact: true }).click();
  await page.locator('#ai-code').fill('print(42)');
  await page.locator('.editor-body:visible').getByLabel('代码语言', { exact: true }).selectOption('python');
  await page.getByRole('button', { name: '分步提示', exact: true }).click();
  await page.getByLabel('题面与输入输出约束').fill('输出整数 42');
  await page.getByLabel('我目前的思路').fill('直接输出');
  await page.getByRole('button', { name: '反例对拍', exact: true }).click();
  await expect(page.locator('#ai-code')).toHaveValue('print(42)');
  await expect(page.getByLabel('题面与输入输出约束')).toHaveValue('输出整数 42');
  await page.goBack();
  await expect(page.getByLabel('我目前的思路')).toHaveValue('直接输出');
  await page.getByRole('button', { name: '复盘笔记', exact: true }).click();
  await expect(page.getByLabel('当时的思路', { exact: false })).toHaveValue('未保存的思路');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('.sidebar nav').getByRole('link', { name: '错题库', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Experience Fixture' })).toBeVisible();
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await expect(page.getByText('复盘已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('当时的思路', { exact: false })).toHaveValue('未保存的思路');
  await page.getByRole('button', { name: '解题助手', exact: true }).click();
  await expect(page.getByRole('link', { name: '设置与数据 → AI 助手' })).toBeVisible();
  await page.getByRole('link', { name: '设置与数据 → AI 助手' }).click();
  await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeVisible();
});

test('all task destinations fit desktop and mobile with useful empty states', async ({ page }, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/?view=transfers',
      '/contests?view=upsolve',
      '/statistics?view=diagnosis',
      '/knowledge?view=ask',
      '/settings?view=sync',
      '/problems/6000%3AA?view=assistant&tool=stress',
    ]) {
      await page.goto(url(pages, path));
      await expect(page.locator('.workspace h1')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await expect(page.locator('.opening-intro, .page-scene, .switch-surface__veil')).toHaveCount(0);
      if (path.startsWith('/problems/')) {
        expect(
          (await page.getByRole('button', { name: '解题助手', exact: true }).boundingBox())!.y,
        ).toBeLessThan(650);
        await page.getByRole('button', { name: '记录重做', exact: true }).click();
        await expect(page.getByRole('heading', { name: '重做与尝试', exact: true })).toBeFocused();
      }
      await page.screenshot({
        path: info.outputPath(`task-${width}-${path.split('?')[0].replaceAll('/', '-') || 'home'}.png`),
        fullPage: true,
      });
    }
  }
});

test('in-page tool switches retain scroll while navigation and history restore it', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  const settleScroll = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(url(pages, '/problems/6000%3AA?view=assistant&tool=code'));
    const hints = page.getByRole('button', { name: '分步提示', exact: true });
    await expect(hints).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 100));
    await settleScroll();
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(80);
    await hints.click();
    await expect(page).toHaveURL(/tool=hints/);
    await settleScroll();
    expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2);
    await page.getByRole('button', { name: '反例对拍', exact: true }).click();
    await expect(page).toHaveURL(/tool=stress/);
    await settleScroll();
    expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2);

    await page.goBack();
    await expect(page).toHaveURL(/tool=hints/);
    await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2);
    await page.goForward();
    await expect(page).toHaveURL(/tool=stress/);
    await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2);

    const settings = page.getByRole('link', { name: '设置与数据 → AI 助手' });
    await settings.scrollIntoViewIfNeeded();
    await settings.click();
    await expect(page.getByRole('heading', { name: 'AI 助手配置' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  }
});

test('late statistics response cannot replace the selected source', async ({ page }, info) => {
  test.skip(info.project.name === 'pages', 'Browser storage does not issue local statistics requests.');
  const store = new Store(':memory:');
  const stats = store.combinedStatistics('all');
  store.close();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/statistics?source=all', async (route) => {
    await held;
    await route.fulfill({ json: { ...stats, submissions: 111 } });
  });
  await page.route('**/api/statistics?source=cf', (route) =>
    route.fulfill({ json: { ...stats, submissions: 222 } }),
  );
  await page.goto('/statistics');
  await page.getByLabel('统计来源').selectOption('cf');
  const count = page.locator('.metric').filter({ hasText: '同步提交总数' }).locator('strong');
  await expect(count).toContainText('222');
  const settled = page.waitForResponse((response) => response.url().endsWith('/api/statistics?source=all'));
  release();
  await settled;
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(page.getByLabel('统计来源')).toHaveValue('cf');
  await expect(count).toContainText('222');
});
