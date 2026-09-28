import { test, expect } from '@playwright/test';
import { mockCodeforces } from '../browser-fixture';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'pages') await mockCodeforces(page);
});

test('opening plays once per session, supports skip and reduced motion', async ({ page }, testInfo) => {
  const url = testInfo.project.name === 'pages' ? './#/' : '/';
  await page.goto(url);
  const intro = page.getByRole('dialog', { name: '回解开屏动画' });
  const skip = page.getByRole('button', { name: '跳过动画' });
  await expect(intro).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(intro).toHaveCount(0);
  await expect(page.locator('.brand')).toBeFocused();
  await expect(page.getByRole('heading', { name: '今日题单' })).toBeVisible();
  await page.locator('.sidebar nav').getByRole('link', { name: '错题库' }).click();
  await expect(intro).toHaveCount(0);
  await page.reload();
  await expect(intro).toHaveCount(0);

  await page.evaluate(() => sessionStorage.removeItem('contest-review:intro-seen:v1'));
  await page.reload();
  await expect(intro).toBeVisible();
  await skip.click();
  await expect(intro).toHaveCount(0);

  await page.evaluate(() => sessionStorage.removeItem('contest-review:intro-seen:v1'));
  await page.reload();
  await expect(intro).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(intro).toHaveCount(0);

  await page.evaluate(() => sessionStorage.removeItem('contest-review:intro-seen:v1'));
  await page.reload();
  await expect(intro).toHaveCount(0);
  await expect(page.locator('.page-head h1')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('opening completes automatically without mobile overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(testInfo.project.name === 'pages' ? './#/' : '/');
  const intro = page.getByRole('dialog', { name: '回解开屏动画' });
  await expect(intro).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(intro).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('.sidebar nav a.active')).toBeFocused();
  await expect(page.getByRole('heading', { name: '今日题单' })).toBeVisible();
});

test('navigation spring, chart endpoint and reduced-motion fallback', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(testInfo.project.name === 'pages' ? './#/' : '/');
  const indicator = page.locator('.nav-indicator');
  const active = page.locator('.sidebar nav a.active');
  await expect(indicator).toBeVisible();
  await expect
    .poll(async () => {
      const marker = await indicator.boundingBox();
      const link = await active.boundingBox();
      return marker && link ? Math.abs(marker.x - link.x) + Math.abs(marker.y - link.y) : 100;
    })
    .toBeLessThan(2);
  await page.locator('.sidebar nav').getByRole('link', { name: '错题库' }).click();
  await expect
    .poll(async () => {
      const marker = await indicator.boundingBox();
      const link = await active.boundingBox();
      return marker && link ? Math.abs(marker.y - link.y) : 100;
    })
    .toBeLessThan(2);
  await page.locator('.sidebar nav').getByRole('link', { name: '训练统计' }).click();
  await page.locator('.sidebar nav').getByRole('link', { name: '今日题单' }).click();
  await expect
    .poll(async () => {
      const marker = await indicator.boundingBox();
      const link = await active.boundingBox();
      return marker && link ? Math.abs(marker.y - link.y) : 100;
    })
    .toBeLessThan(2);

  await page.locator('.profile-chip').click();
  await page.getByLabel('Codeforces Handle').fill(`motion_tester_${testInfo.repeatEachIndex}`);
  await page.getByRole('button', { name: '绑定用户名' }).click();
  await expect(page.locator('.profile-chip')).toContainText(`motion_tester_${testInfo.repeatEachIndex}`);
  await expect(page.getByRole('button', { name: '绑定用户名' })).toBeEnabled();
  await page.getByRole('button', { name: '同步状态' }).click();
  await page.getByRole('button', { name: '开始首次同步' }).click();
  await expect(page.getByText('同步完成', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.locator('.sidebar nav').getByRole('link', { name: '训练统计' }).click();
  const radar = page.locator('.mastery-radar');
  await expect(radar).toBeVisible();
  await expect
    .poll(async () =>
      radar.evaluate((svg) => {
        const score = Number(svg.getAttribute('data-target-scores')!.split(',')[0]);
        const topY = Number(
          svg.querySelector('.radar-value')!.getAttribute('points')!.split(' ')[0].split(',')[1],
        );
        return Math.abs(topY - (160 - score * 1.1));
      }),
    )
    .toBeLessThan(0.1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.sidebar nav').getByRole('link', { name: '今日题单' }).click();
  await page.locator('.sidebar nav').getByRole('link', { name: '训练统计' }).click();
  await expect(radar).toBeVisible();
  const reduced = await radar.evaluate((svg) => {
    const score = Number(svg.getAttribute('data-target-scores')!.split(',')[0]);
    const topY = Number(
      svg.querySelector('.radar-value')!.getAttribute('points')!.split(' ')[0].split(',')[1],
    );
    return Math.abs(topY - (160 - score * 1.1));
  });
  expect(reduced).toBeLessThan(0.01);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const marker = await indicator.boundingBox();
      const link = await active.boundingBox();
      return marker && link ? Math.abs(marker.x - link.x) + Math.abs(marker.y - link.y) : 100;
    })
    .toBeLessThan(2);
  for (const label of ['今日题单', '错题库', '比赛复盘', '训练统计']) {
    await page.locator('.sidebar nav').getByRole('link', { name: label }).click();
    await expect(page.locator('.page-head h1')).toContainText(label);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
        message: `${label} should fit the mobile viewport`,
      })
      .toBe(true);
  }
  await page.locator('.sidebar nav a').first().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).not.toBe('none');
  await page.locator('.profile-chip').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
