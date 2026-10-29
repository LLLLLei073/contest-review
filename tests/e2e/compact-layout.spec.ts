import { test, expect } from '@playwright/test';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
import { mockCodeforces } from '../browser-fixture';

test('compact layouts keep summaries in view, expose details on demand and fit all navigation items', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  const target = (path: string) => (pages ? './#' + path : path);
  const store = new Store(':memory:');
  store.activate('compact_layout');
  store.markRecentChecked('compact_layout');
  const backup = store.backup();
  store.close();
  if (pages) await mockCodeforces(page);
  await page.goto(target('/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'compact.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('compact_layout');
  await page.goto(target('/statistics'));
  await expect(page.locator('.statistics-metrics')).toBeVisible();
  const measurements = [];
  for (const [width, height] of [
    [1440, 900],
    [768, 960],
    [503, 706],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    expect((await page.locator('.statistics-mastery').boundingBox())!.y).toBeLessThan(400);
    expect((await page.locator('.statistics-metrics').boundingBox())!.height).toBeLessThan(
      width <= 650 ? 175 : 105,
    );
    const nav = page.locator('.sidebar');
    expect(await nav.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const links = page.getByRole('navigation', { name: '主导航' }).getByRole('link');
    await expect(links).toHaveCount(10);
    if (width <= 650) {
      expect(
        (await links.last().boundingBox())!.y + (await links.last().boundingBox())!.height,
      ).toBeLessThanOrEqual(height);
      await page.getByRole('button', { name: '领域明细', exact: true }).click();
      await expect(page.locator('.mastery-list')).toBeVisible();
      await expect(page.locator('.mastery-radar')).toBeHidden();
      await expect(page.locator('.mastery-row')).toHaveCount(8);
      await page.getByRole('button', { name: '雷达图', exact: true }).click();
      await expect(page.locator('.mastery-radar')).toBeVisible();
      await expect(page.locator('.mastery-list')).toBeHidden();
    }
    measurements.push(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        pageHeight: document.documentElement.scrollHeight,
        masteryTop: document.querySelector('.statistics-mastery')!.getBoundingClientRect().top,
        navHeight: document.querySelector('.sidebar')!.getBoundingClientRect().height,
      })),
    );
    await page.screenshot({ path: info.outputPath(`compact-statistics-${width}.png`), fullPage: true });
  }
  await info.attach('layout-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  await page.getByRole('button', { name: '练习趋势', exact: true }).click();
  await expect(page.locator('.statistics-trend')).toBeVisible();
  await expect(page.locator('.statistics-distribution')).toBeHidden();
  await expect(page.locator('.daily-history-grid')).toBeHidden();
  await page.locator('.statistics-history summary').click();
  await expect(page.locator('.daily-history-grid')).toBeVisible();
  await page.getByRole('button', { name: '错因与算法分布', exact: true }).click();
  await expect(page.locator('.statistics-distribution')).toBeVisible();
  await expect(page.locator('.statistics-trend')).toBeHidden();
  await page.reload();
  await expect(page.locator('.statistics-distribution')).toBeVisible();
  await page.getByRole('button', { name: '错因变化', exact: true }).click();
  await expect(page.locator('.statistics-reasons')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.statistics-distribution')).toBeVisible();
  await page.goto(target('/settings?view=accounts'));
  await expect(page.locator('.connection-cards')).toBeVisible();
  expect((await page.locator('.connection-cards').boundingBox())!.height).toBeLessThan(140);
  await page.getByRole('button', { name: '切换为深色模式' }).click();
  await page.screenshot({ path: info.outputPath('compact-settings-mobile.png'), fullPage: true });
});
