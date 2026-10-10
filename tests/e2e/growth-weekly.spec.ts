import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import { emptyReview, type CFSubmission } from '../../shared/domain';
import { weekStart } from '../../shared/weekly';
import { mockCodeforces } from '../browser-fixture';
function fixture() {
  const s = new Store(':memory:');
  s.activate('advanced_growth');
  const now = Date.now();
  const week = weekStart(new Date());
  const at = Date.parse(week + 'T00:00:00+08:00') + 3600000;
  const sub = (id: number, index: string, t: number, tags = ['math']): CFSubmission => ({
    id,
    contestId: 9800,
    creationTimeSeconds: Math.floor(t / 1000),
    problem: { contestId: 9800, index, name: '研习 ' + index, tags },
    verdict: 'OK',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  });
  s.ingest(
    'advanced_growth',
    Array.from({ length: 240 }, (_, i) => sub(i + 1, 'R' + i, now - (400 - i) * 86400000)),
  );
  s.ingest('advanced_growth', [
    ...Array.from({ length: 10 }, (_, i) => sub(1000 + i, 'R' + i, at, i === 0 ? ['dp'] : ['math'])),
    ...Array.from({ length: 5 }, (_, i) => sub(2000 + i, 'X' + i, at, i === 0 ? ['dp'] : ['math'])),
  ]);
  for (let i = 0; i < 10; i++) {
    s.put('attempts', 'advanced_growth', 'redo' + i, {
      id: 'redo' + i,
      problemKey: '9800:R' + i,
      result: 'independent',
      createdAt: new Date(at + 60000).toISOString(),
      minutes: 30,
      note: '',
    });
    s.put('reviews', 'advanced_growth', '9800:R' + i, {
      ...emptyReview(),
      solution: '完成有效推演',
      firstReflectionAt: new Date(at + 120000).toISOString(),
    });
  }
  s.saveWeeklyGoal({ mode: 'balanced', categories: ['数学', '动态规划'] });
  const backup = s.backup();
  s.close();
  return backup;
}
test('higher-stage conditions, complete weekly rewards, filters, evidence and offline four new assets', async ({
  page,
  context,
}, info) => {
  const pages = info.project.name === 'pages';
  const target = (p: string) => (pages ? './#' + p : p);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (pages) {
    await mockCodeforces(page);
    await page.route('https://codeforces.com/api/user.status*', (r) =>
      r.fulfill({ json: { status: 'OK', result: [] }, headers: { 'Access-Control-Allow-Origin': '*' } }),
    );
  } else
    await page.route('**/api/training/recent', (r) =>
      r.fulfill({ json: { checkedAt: new Date().toISOString(), error: null } }),
    );
  await page.goto(target('/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'advanced-growth.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('advanced_growth');
  await page.goto(target('/growth'));
  await expect(page.locator('.cosmetic-card')).toHaveCount(7);
  await expect(page.locator('.growth-weekly')).toContainText('180 / 180 EXP');
  await expect(page.locator('.weekly-growth-task.complete')).toHaveCount(3);
  await expect(page.locator('.stage-route .current')).toContainText('星图研习');
  const atlas = page
    .locator('.cosmetic-card')
    .filter({ has: page.getByRole('heading', { name: '星图研习', exact: true }) });
  await atlas.getByRole('button', { name: '装备外观', exact: true }).click();
  await atlas.getByRole('button', { name: '应用配色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ice');
  const next = page
    .locator('.cosmetic-card')
    .filter({ has: page.getByRole('heading', { name: '深空观测', exact: true }) });
  await expect(next.getByRole('button', { name: '装备外观', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '周任务', exact: true }).click();
  await expect(page.locator('.achievement-card')).toHaveCount(4);
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.locator('.achievement-card')).toHaveCount(26);
  await expect(page.locator('.weekly-event-proof').first()).toBeVisible();
  await page.locator('.weekly-event-proof summary').first().click();
  await expect(page.locator('.weekly-event-proof').first()).toContainText('研习');
  await page.getByRole('button', { name: '关闭成长奖励' }).click();
  await expect(page.locator('.growth-reward')).toHaveCount(0);
  if (await page.getByRole('button', { name: '关闭通知' }).count())
    await page.getByRole('button', { name: '关闭通知' }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '独立重做', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '独立重做', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.screenshot({ path: info.outputPath('advanced-growth-' + width + '.png'), fullPage: true });
    await page
      .locator('.growth-weekly')
      .screenshot({ path: info.outputPath('weekly-panel-' + width + '.png') });
    await page
      .locator('.growth-route')
      .screenshot({ path: info.outputPath('stage-panel-' + width + '.png') });
  }
  await page.reload();
  await expect(page.locator('.growth-reward')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'ice');
  await expect(page.locator('.growth-weekly')).toContainText('180 / 180 EXP');
  if (pages) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.growth-weekly')).toContainText('180 / 180 EXP');
    await expect
      .poll(() =>
        page
          .locator('.companion img')
          .evaluateAll((images) => images.every((i) => (i as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    await context.setOffline(false);
  }
  expect(errors).toEqual([]);
});
