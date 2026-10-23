import { test, expect } from '@playwright/test';
import { mockCodeforces } from '../browser-fixture';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'pages') await mockCodeforces(page);
  else {
    // Other flows share the fixture server; wait for any async analysis to settle.
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/contests/2000/analysis');
          const data = await response.json();
          return data.task?.status !== 'running';
        },
        { timeout: 20000 },
      )
      .toBe(true);
    // The insights page also polls recent-submission checks; keep it from starting network sync.
    await page.route('**/api/training/recent', (route) =>
      route.fulfill({ json: { checkedAt: new Date().toISOString(), error: null } }),
    );
  }
});

test('insights page shows three platform cards with bind entry points', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(testInfo.project.name === 'pages' ? './#/insights' : '/insights');
  await expect(page.locator('.page-head h1')).toContainText('数据总览');
  await expect(page.getByRole('heading', { name: '数据总览', exact: true })).toBeFocused();
  const cards = page.locator('.account-card');
  await expect(cards).toHaveCount(3);
  for (const title of ['Codeforces', 'AtCoder', '洛谷']) {
    await expect(cards.filter({ hasText: title })).toBeVisible();
  }
  if (testInfo.project.name === 'pages')
    await expect(page.getByText('洛谷同步仅本地模式可用')).toBeVisible();
  else {
    // 本地模式下未绑定时提供内联绑定表单；共享 fixture 中 CF/AtCoder 可能已被其他用例绑定
    await expect(page.getByLabel('洛谷 UID')).toBeVisible();
    const cfCard = page.locator('.account-card', { hasText: 'Codeforces' });
    await expect(cfCard.getByText('已连接').or(cfCard.getByLabel('Codeforces 用户名'))).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('insights aggregates bound accounts, radar and charts from a full payload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'pages', 'Pages 模式没有本地 HTTP API 可注入汇总数据。');
  const mastery = (offset: number) =>
    ['实现与模拟', '贪心与构造', '数学', '数据结构', '图与树', '动态规划', '字符串', '搜索与技巧'].map(
      (name, i) => ({ name, score: 40 + offset + i, samples: 3 + i }),
    );
  const payload = {
    generatedAt: new Date().toISOString(),
    accounts: [
      {
        platform: 'cf',
        handle: 'insights_user',
        name: 'insights_user',
        bound: true,
        rating: 1543,
        solved: 20,
        officialSolved: null,
        submissions: 50,
        lastSync: new Date().toISOString(),
      },
      {
        platform: 'atcoder',
        handle: 'insights_user',
        name: 'insights_user',
        bound: true,
        rating: 1200,
        solved: 8,
        officialSolved: null,
        submissions: 30,
        lastSync: new Date().toISOString(),
      },
      {
        platform: 'luogu',
        handle: '109757',
        name: '汇总示例',
        bound: true,
        rating: null,
        solved: 6,
        officialSolved: 42,
        submissions: 12,
        lastSync: new Date().toISOString(),
      },
    ],
    totals: { solved: 34, submissions: 92, activeDays: 17 },
    ratings: {
      cf: [
        { t: 1789000000, rating: 1400 },
        { t: 1789900000, rating: 1543 },
      ],
      atcoder: [
        { t: 1789200000, rating: 1100 },
        { t: 1789800000, rating: 1200 },
      ],
    },
    mastery: { all: mastery(10), cf: mastery(8), atcoder: mastery(4), luogu: mastery(0) },
    difficulty: [
      { label: '≤999', cf: 3, atcoder: 2, luogu: 4 },
      { label: '1000-1199', cf: 5, atcoder: 1, luogu: 1 },
      { label: '1200-1399', cf: 6, atcoder: 3, luogu: 1 },
      { label: '1400-1599', cf: 4, atcoder: 1, luogu: 0 },
      { label: '1600-1899', cf: 2, atcoder: 1, luogu: 0 },
      { label: '1900-2199', cf: 0, atcoder: 0, luogu: 0 },
      { label: '2200-2599', cf: 0, atcoder: 0, luogu: 0 },
      { label: '2600+', cf: 0, atcoder: 0, luogu: 0 },
    ],
    activity: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      cf: i,
      atcoder: i % 3,
      luogu: i % 2,
    })),
  };
  await page.route('**/api/insights', (route) => route.fulfill({ json: payload }));
  await page.goto('/insights');
  // 关键指标
  await expect(page.locator('.metric', { hasText: '总通过题数' })).toContainText('34');
  await expect(page.locator('.metric', { hasText: '总提交记录' })).toContainText('92');
  await expect(page.locator('.metric', { hasText: '活跃天数' })).toContainText('17');
  await expect(page.locator('.metric', { hasText: 'Codeforces' })).toContainText('1543');
  // 账号卡：洛谷显示官方通过数
  const luoguCard = page.locator('.account-card', { hasText: '洛谷' });
  await expect(luoguCard).toContainText('汇总示例');
  await expect(luoguCard).toContainText('42');
  // Rating 走势：两条折线
  await expect(page.locator('.rating-chart polyline')).toHaveCount(2);
  // 雷达：默认只有「全部来源」一个系列，图例隐藏
  const radar = page.locator('.mastery-radar');
  await expect(radar).toBeVisible();
  await expect(page.locator('.radar-value')).toHaveCount(1);
  await expect(page.locator('.radar-legend-item')).toHaveCount(0);
  await expect(radar).toHaveAttribute('data-target-scores', mastery(10).map((m) => m.score).join(','));
  // 叠加 Codeforces 系列：出现图例且弹簧重建
  await page.getByRole('button', { name: 'Codeforces', exact: true }).click();
  await expect(page.locator('.radar-legend-item')).toHaveCount(2);
  // 难度分布与活跃趋势堆叠柱
  await expect(page.locator('.stacked-chart')).toHaveCount(2);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('insights page binds Codeforces and syncs inline', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(testInfo.project.name === 'pages' ? './#/insights' : '/insights');
  // 首轮汇总加载完成后卡片状态才稳定（共享 fixture 中 CF 可能已被其他用例绑定）
  await expect(page.getByText('正在汇总各平台数据…')).toBeHidden();
  const cfCard = page.locator('.account-card', { hasText: 'Codeforces' });
  const cfInput = page.getByLabel('Codeforces 用户名');
  // 有界等待：表单出现则绑定；5 秒后仍无表单则视为已被其他用例绑定，直接进入同步
  if (
    await cfInput.waitFor({ state: 'visible', timeout: 5000 }).then(
      () => true,
      () => false,
    )
  ) {
    await cfInput.fill(`insights_user_${testInfo.workerIndex}`);
    await cfCard.getByRole('button', { name: '绑定' }).click();
  }
  await expect(cfCard).toContainText('已连接');
  await expect(page.locator('.metric', { hasText: '总通过题数' })).toBeVisible();
  await cfCard.getByRole('button', { name: '同步数据' }).click();
  // 同步完成后轮询会自动刷新汇总：总通过题数从 0 变为真实数量
  const solved = page.locator('.metric', { hasText: '总通过题数' }).locator('strong');
  await expect
    .poll(async () => solved.textContent(), { timeout: 20000 })
    .not.toBe('0');
  await expect(page.locator('.radar-value')).toHaveCount(1);
  expect(errors).toEqual([]);
});
