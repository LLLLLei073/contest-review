import { test, expect, type Page } from '@playwright/test';
import { Store } from '../../server/store';
import type { CFSubmission } from '../../shared/domain';
import { mockCodeforces } from '../browser-fixture';

function fixture(count = 50) {
  const store = new Store(':memory:');
  store.activate('growth_tester');
  const submissions: CFSubmission[] = Array.from({ length: count }, (_, i) => ({
    id: 88000 + i,
    contestId: 8800,
    creationTimeSeconds: Date.parse('2020-10-01T00:00:00Z') / 1000 + i,
    problem: { contestId: 8800, index: String(i), name: 'Growth problem ' + i, tags: ['math'] },
    verdict: 'OK',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  }));
  store.ingest('growth_tester', submissions);
  const backup = store.backup();
  store.close();
  return backup;
}
const destination = (pages: boolean, path: string) => (pages ? './#' + path : path);
async function restore(page: Page, pages: boolean, count = 50) {
  if (pages) {
    await mockCodeforces(page);
    await page.route('https://codeforces.com/api/user.status*', (r) =>
      r.fulfill({ json: { status: 'OK', result: [] }, headers: { 'Access-Control-Allow-Origin': '*' } }),
    );
  } else
    await page.route('**/api/training/recent', (r) =>
      r.fulfill({ json: { checkedAt: new Date().toISOString(), error: null } }),
    );
  await page.goto(destination(pages, '/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'growth.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture(count))),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('growth_tester');
}
test('historical growth, unlocks, equipment persistence, pagination, account isolation and offline assets', async ({
  page,
  context,
}, info) => {
  const pages = info.project.name === 'pages';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await restore(page, pages);
  await expect(page.getByText('历史成长已汇总', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭成长奖励' }).click();
  await expect(page.locator('.growth-reward')).toHaveCount(0);
  await page.locator('.sidebar nav').getByRole('link', { name: '成长收藏' }).click();
  await expect(page.locator('.growth-level')).toContainText('Lv.5');
  await expect(page.locator('.growth-level')).toContainText('1000 EXP');
  await expect(page.locator('.growth-event-list li')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页经验记录' }).click();
  await expect(page.locator('.growth-pagination')).toContainText('2 / 3');
  await page.getByRole('button', { name: '下一页经验记录' }).click();
  await expect(page.locator('.growth-event-list li')).toHaveCount(10);
  const orbit = page
    .locator('.cosmetic-card')
    .filter({ has: page.getByRole('heading', { name: '星轨领航' }) });
  await orbit.getByRole('button', { name: '装备外观' }).click();
  await expect(orbit.getByRole('button', { name: '外观已装备' })).toBeDisabled();
  await orbit.getByRole('button', { name: '应用配色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'gold');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'gold');
  await expect(page.locator('.growth-profile__art img')).toHaveAttribute('src', /orbit/);
  await expect(page.locator('.growth-reward')).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator('.companion img')
        .evaluateAll((images) => images.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('growth-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.screenshot({ path: info.outputPath('growth-mobile.png'), fullPage: true });
  if (pages) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.growth-level')).toContainText('1000 EXP');
    await expect
      .poll(() =>
        page
          .locator('.companion img')
          .evaluateAll((images) => images.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'gold');
    await context.setOffline(false);
  }
  await page.goto(destination(pages, '/settings?view=accounts'));
  await page.getByLabel('Codeforces Handle').fill('growth_other');
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.locator('.profile-chip')).toContainText('growth_other');
  await page.goto(destination(pages, '/growth'));
  await expect(page.locator('.growth-level')).toContainText('Lv.1');
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'cyan');
  await expect(
    page.locator('.cosmetic-card').nth(1).getByRole('button', { name: '装备外观' }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
test('terminal routes remain readable and contained at desktop and mobile, keyboard focus and loading failures recover', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await restore(page, pages, 1);
  await page.getByRole('button', { name: '关闭成长奖励' }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/', '/problems', '/contests', '/statistics', '/knowledge', '/growth', '/settings']) {
      await page.goto(destination(pages, path));
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      const bg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe('rgb(9, 15, 29)');
      if (path === '/')
        await page.screenshot({ path: info.outputPath(`terminal-home-${width}.png`), fullPage: true });
    }
  }
  await page.goto(destination(pages, '/growth'));
  await page.locator('.sidebar nav').getByRole('link', { name: '今日训练' }).focus();
  await expect(page.locator('.sidebar nav').getByRole('link', { name: '今日训练' })).toBeFocused();
  const checked = pages ? null : page.waitForResponse('**/api/training/recent');
  await page.keyboard.press('Enter');
  await expect(page.locator('.growth-hero')).toBeVisible();
  if (checked) await checked;
  if (!pages) {
    await page.route('**/api/growth/history*', (r) =>
      r.fulfill({ status: 503, json: { error: '成长记录暂时不可用' } }),
    );
    await page.goto('/growth');
    await expect(page.getByRole('alert')).toContainText('成长记录暂时不可用');
    await page.unroute('**/api/growth/history*');
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.locator('.growth-event-list li')).toHaveCount(1);
  }
});
