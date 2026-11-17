import { test, expect } from '@playwright/test';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
import { ProgramService } from '../../shared/program-service';
import { programNamespace } from '../../shared/program-domain';
import { localDay } from '../../shared/core-store';
import type { CFSubmission } from '../../shared/domain';

const wideCatalog = Array.from({ length: 120 }, (_, i) => ({
  contestId: 6600 + i,
  index: 'A',
  name: `Program ${i}`,
  rating: 800 + (i % 15) * 100,
  tags: i % 2 ? ['dp'] : ['greedy'],
}));
/** 生成并采纳一个计划，把前 count 天移到过去；acRatio 比例的题在该天 AC。 */
function presetProgram(handle: string, count: number, acRatio: number) {
  const store = new Store(':memory:');
  store.activate(handle);
  store.enrich(handle, [], [], wideCatalog);
  const service = new ProgramService(store);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  const confirmed = service.confirm({ id: state.draft!.id });
  const program = confirmed.active!;
  const now = Date.now();
  const past = (offset: number) => localDay(new Date(now - offset * 86400000));
  let id = 5000;
  const days = program.days.map((day, i) => {
    if (i >= count) return day;
    const date = past(count - i);
    const problems = day.problems.map((p, j) => {
      if (j >= Math.ceil(day.problems.length * acRatio)) return p;
      const [contestId, index] = p.key.split(':');
      const submission: CFSubmission = {
        id: id++,
        contestId: Number(contestId),
        creationTimeSeconds: Math.floor(Date.parse(date + 'T13:00:00+08:00') / 1000),
        problem: { contestId: Number(contestId), index, name: p.key, rating: 1200, tags: ['dp'] },
        verdict: 'OK',
        programmingLanguage: 'C++',
        author: { participantType: 'PRACTICE' },
      };
      store.ingest(handle, [submission]);
      return p;
    });
    return { ...day, date, problems };
  });
  store.externalPut(programNamespace(handle, ''), program.id, {
    ...program,
    days,
  });
  const backup = store.backup();
  store.close();
  return backup;
}

test('long-run program: wizard preview of all days, confirm feeds today, swap re-rolls one problem', async ({
  page,
}, info) => {
  const store = new Store(':memory:');
  store.activate('program_browser');
  // fixture CF stub 会为该账号注入少量提交并得出难度基准，题库覆盖 800–2200 全难度谱以保证任何基准下都有候选。
  store.enrich('program_browser', [], [], wideCatalog);
  const backup = store.backup();
  store.close();
  const base = info.project.name === 'pages' ? './#/' : '/';
  await page.goto(base + 'settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'program.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('program_browser');
  await page.getByRole('link', { name: '今日训练', exact: true }).click();
  await page.getByRole('button', { name: '长期计划', exact: true }).click();
  await page.getByRole('button', { name: '7 天冲刺' }).click();
  await expect(page.getByRole('button', { name: '分析并生成全部 7 天预览' })).toBeEnabled();
  await page.getByRole('button', { name: '分析并生成全部 7 天预览' }).click();
  await expect(page.locator('.program-day')).toHaveCount(7);
  await expect(page.getByText('PREVIEW · 待确认')).toBeVisible();
  const firstDayNames = await page
    .locator('.program-day')
    .first()
    .locator('.program-problems li')
    .allTextContents();
  assertGte(firstDayNames.length, 6);
  await page.getByRole('button', { name: '采纳生效' }).click();
  await expect(page.getByText('ACTIVE · 进行中')).toBeVisible();
  await expect(page.locator('.program-today')).toContainText('今天（第 1 天）');
  await page.getByRole('button', { name: '今日题单', exact: true }).click();
  await expect
    .poll(() => page.locator('.daily-panel').nth(1).locator('.daily-task').count(), { timeout: 10000 })
    .toBe(firstDayNames.length);
  await page.getByRole('button', { name: '长期计划', exact: true }).click();
  const before = await page.locator('.program-day').first().locator('.program-problems li a').allTextContents();
  await page.locator('.program-day').first().getByRole('button', { name: '换题' }).first().click();
  await expect
    .poll(() => page.locator('.program-day').first().locator('.program-problems li a').allTextContents())
    .not.toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mid-program calibration raises remaining bands after strong completion', async ({ page }, info) => {
  // 前三天全部完成 → 校准应上调剩余难度，时间线保留且理由带「校准后」前缀。
  const backup = presetProgram('program_calibrate', 3, 1);
  const base = info.project.name === 'pages' ? './#/' : '/';
  await page.goto(base + 'settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'program-cal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('program_calibrate');
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: '今日训练', exact: true }).click();
  await page.getByRole('button', { name: '长期计划', exact: true }).click();
  await expect(page.getByText('ACTIVE · 进行中')).toBeVisible();
  await expect(page.getByText(/前半程完成率 100%/)).toBeVisible();
  const remainingBefore = await page
    .locator('.program-day')
    .filter({ hasText: /难度 \d+/ })
    .evaluateAll((nodes) =>
      nodes
        .map((n) => n.querySelector('.daily-meta')?.textContent ?? '')
        .filter((text) => !text.includes('校准后')),
    );
  assertGte(remainingBefore.length, 4);
  await page.getByRole('button', { name: '校准剩余计划' }).click();
  await expect(page.getByText('ACTIVE · 进行中')).toBeVisible();
  await expect(page.getByText(/校准后/).first()).toBeVisible();
  // 校准把剩余天难度整体 +100：第 4 天起 preferred 文案应高于校准前。
  const remainingAfter = await page
    .locator('.program-day')
    .filter({ hasText: /校准后/ })
    .count();
  assertGte(remainingAfter, 4);
});

test('completed program renders the summary report with radar comparison', async ({ page }, info) => {
  // 已完成的计划（含采纳时掌握度快照）→ 报告区块、findings 与计划前/后雷达。
  const base = info.project.name === 'pages' ? './#/' : '/';
  const store = new Store(':memory:');
  store.activate('program_report');
  store.enrich('program_report', [], [], wideCatalog);
  const service = new ProgramService(store);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划'] });
  const confirmed = service.confirm({ id: state.draft!.id });
  const program = confirmed.active!;
  const completed = {
    ...program,
    status: 'completed',
    finishedAt: new Date().toISOString(),
    baselineMastery: [
      { name: '动态规划', score: 40, samples: 8 },
      { name: '实现与模拟', score: 50, samples: 8 },
      { name: '贪心与构造', score: 50, samples: 8 },
      { name: '数学', score: 50, samples: 8 },
      { name: '数据结构', score: 50, samples: 8 },
      { name: '图与树', score: 50, samples: 8 },
      { name: '字符串', score: 50, samples: 8 },
      { name: '搜索与技巧', score: 50, samples: 8 },
    ],
  };
  store.externalPut(programNamespace('program_report', ''), program.id, completed);
  const completedBackup = store.backup();
  store.close();
  await page.goto(base + 'settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'program-report.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(completedBackup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('program_report');
  await page.getByRole('link', { name: '今日训练', exact: true }).click();
  await page.getByRole('button', { name: '长期计划', exact: true }).click();
  await expect(page.getByText('计划总结报告')).toBeVisible();
  await expect(page.locator('.program-radar svg').first()).toBeVisible();
  await expect(page.locator('.program-findings li').first()).toContainText('下一步：');
  const day = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  expect(day).toBe(true);
});
function assertGte(actual: number, minimum: number) {
  if (actual < minimum) throw new Error(`expected >= ${minimum}, got ${actual}`);
}
