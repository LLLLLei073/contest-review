import { test, expect, type Page } from '@playwright/test';
import { Store } from '../../server/store';
import { BattleService } from '../../shared/battle-service';
import { mockCodeforces } from '../browser-fixture';

async function restore(page: Page, backup: unknown, pages: boolean) {
  await page.goto(pages ? './#/settings?view=backup' : '/settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'battle.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('battle_browser');
}
function seed() {
  const store = new Store(':memory:');
  store.activate('battle_browser');
  store.enrich(
    'battle_browser',
    [],
    [],
    Array.from({ length: 30 }, (_, i) => ({
      contestId: 7300 + i,
      index: 'A',
      name: '连战练习 ' + i,
      rating: 1100,
      tags: ['dp', 'implementation'],
    })),
  );
  store.markRecentChecked('battle_browser');
  return store;
}
test('battle automatically advances verified AC, evaluates without leaving the task and restores pause across reload', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages',
    target = (path: string) => (pages ? './#' + path : path);
  if (pages) await mockCodeforces(page);
  const store = seed();
  const startAt = new Date(Date.now() - 3600000);
  const battle = new BattleService(store, () => startAt);
  const session = battle.start({
    handle: 'battle_browser',
    skillId: 'dp',
    operationId: crypto.randomUUID(),
  }).session!;
  const first = session.items[0];
  store.ingest('battle_browser', [
    {
      id: 998877,
      contestId: first.problem.contestId,
      creationTimeSeconds: Math.floor(startAt.getTime() / 1000) + 120,
      problem: { ...first.problem, rating: first.problem.rating! },
      verdict: 'OK',
      programmingLanguage: 'GNU C++20',
      author: { participantType: 'PRACTICE', members: [{ handle: 'battle_browser' }] },
    },
  ]);
  const backup = store.backup();
  store.close();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await restore(page, backup, pages);
  await page.goto(target('/battle'));
  await expect(page.locator('.battle-evaluation')).toContainText(first.problem.name);
  await expect(page.locator('.battle-problem-title')).not.toHaveText(first.problem.name);
  await expect(page.locator('.battle-current .badge')).toContainText('1 题 AC');
  const second = await page.locator('.battle-problem-title').innerText();
  await page.getByRole('button', { name: '独立完成', exact: true }).click();
  await expect(page.locator('.battle-reward')).toContainText('1.2×');
  await expect(page.locator('.battle-evaluation')).toHaveCount(0);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByRole('heading', { name: '连战已暂停' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '连战已暂停' })).toBeVisible();
  await expect(page.locator('.battle-problem-title')).toHaveText(second);
  await page.getByRole('button', { name: '继续连战', exact: true }).click();
  await expect(page.getByRole('heading', { name: '当前挑战' })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [503, 706],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
      1,
    );
    const button = await page.getByRole('button', { name: '检查 AC / 下一题' }).boundingBox();
    expect(button!.y + button!.height).toBeLessThan(height - (width <= 650 ? 104 : 0));
    await expect(page.locator('.battle-history')).toBeHidden();
    await page.screenshot({ path: info.outputPath(`battle-${width}.png`), fullPage: true });
  }
  await page.getByText('本轮记录与评价修正 · 1 题', { exact: true }).click();
  await page
    .locator('.battle-history')
    .getByRole('combobox', { name: '评价', exact: true })
    .selectOption('hint');
  await expect(page.locator('.battle-reward')).toContainText('1.1×');
  await page.getByRole('button', { name: '跳过此题', exact: true }).click();
  await expect(page.locator('.battle-problem-title')).not.toHaveText(second);
  await page.getByRole('button', { name: '结束本轮并生成总结', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始连战', exact: true })).toBeVisible();
  // fixture 未配置 AI：归档中显示可读提示而不是报错崩溃
  await expect(page.locator('.battle-archive')).toContainText('尚未生成 AI 总结');
  await page.getByRole('button', { name: '切换为深色模式' }).click();
  await page.screenshot({ path: info.outputPath('battle-dark-ended.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('battle entry chooses the knowledge card, starts an isolated round and handles exhaustion explicitly', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages',
    target = (path: string) => (pages ? './#' + path : path);
  if (pages) await mockCodeforces(page);
  const store = seed(),
    backup = store.backup();
  store.close();
  await restore(page, backup, pages);
  await page.goto(target('/knowledge?card=dp'));
  await page.getByRole('link', { name: '开始连战 →', exact: true }).click();
  await expect(page.getByLabel('连战知识点')).toHaveValue('dp');
  await page.getByRole('button', { name: '开始连战', exact: true }).click();
  await expect(page.locator('.battle-current .eyebrow')).toContainText('动态规划');
  await page.getByText('题库与难度', { exact: true }).click();
  await page.getByLabel('最低难度', { exact: true }).fill('2000');
  await page.getByLabel('最高难度', { exact: true }).fill('2200');
  await page.getByRole('button', { name: '保存难度', exact: true }).click();
  await page.getByRole('button', { name: '跳过此题', exact: true }).click();
  await expect(page.locator('.battle-empty')).toContainText('没有新的匹配题目');
  await expect(page.getByRole('heading', { name: '连战已暂停' })).toBeVisible();
  await page.getByLabel('最低难度', { exact: true }).fill('1000');
  await page.getByLabel('最高难度', { exact: true }).fill('1300');
  await page.getByRole('button', { name: '保存难度', exact: true }).click();
  await page.getByRole('button', { name: '继续连战', exact: true }).click();
  await expect(page.locator('.battle-problem-title')).toBeVisible();
  await page.goto(target('/'));
  await expect(page.getByRole('link', { name: '开始连战 →', exact: true })).toBeVisible();
});
