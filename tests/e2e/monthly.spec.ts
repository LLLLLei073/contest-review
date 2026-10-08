import { test, expect, type Page } from '@playwright/test';
import { Store } from '../../server/store';
import { beijingDay } from '../../shared/monthly-report';
import { learningReply } from '../learning-fixture';
import type { CFSubmission } from '../../shared/domain';

const month = beijingDay(new Date()).slice(0, 7);
const now = Date.parse(month + '-01T00:00:00+08:00') / 1000;
const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1))
  .toISOString()
  .slice(0, 7);
function backup(empty = false) {
  const s = new Store(':memory:');
  s.activate('monthly_tester');
  s.activateAtcoder('monthly_ac');
  if (!empty) {
    const submission = (id: number, index: string, time: number, verdict: string): CFSubmission => ({
      id,
      contestId: 2000,
      creationTimeSeconds: time,
      problem: { contestId: 2000, index, name: 'Monthly ' + index, rating: 1000, tags: ['dp'] },
      verdict,
      programmingLanguage: 'C++',
      author: { participantType: 'CONTESTANT' },
    });
    s.ingest('monthly_tester', [
      submission(1, 'A', now - 1000, 'OK'),
      submission(2, 'A', now, 'WRONG_ANSWER'),
      submission(3, 'A', now + 1, 'OK'),
      submission(4, 'B', now + 1, 'OK'),
    ]);
    s.put('contests', 'monthly_tester', '2000', {
      id: 2000,
      name: 'Monthly Contest',
      startTimeSeconds: now,
      durationSeconds: 7200,
    });
    s.ingestAtcoder('ac~monthly_ac', [
      {
        id: 1,
        epoch_second: now,
        problem_id: 'abc001_a',
        contest_id: 'abc001',
        user_id: 'monthly_ac',
        result: 'AC',
        language: 'Python',
      },
    ]);
    s.externalPut('ai', 'config', {
      baseUrl: 'https://learning-ai.test/v1',
      apiKey: 'fixture',
      model: 'learning-fixture',
    });
  }
  const data = s.backup();
  s.close();
  return data;
}
async function restore(page: Page, pages: boolean, empty = false) {
  await page.goto(pages ? './#/settings' : '/settings');
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'monthly.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup(empty))),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.getByText('备份恢复完成', { exact: true })).toBeVisible();
  await expect(page.locator('.profile-chip')).toContainText('monthly_tester');
  await page.goto(pages ? './#/statistics' : '/statistics');
  await page.getByRole('button', { name: '月度报告', exact: true }).click();
  await expect(page.getByRole('heading', { name: '月度算法报告', exact: true })).toBeVisible();
  await expect(page.locator('.monthly-metrics')).toBeVisible();
}
test('monthly report: month/source switches, evidence, AI, reload and mobile layout', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://learning-ai.test/v1/chat/completions', async (route) => {
    const req = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(
                learningReply(req.messages[0].content, JSON.parse(req.messages[1].content)),
              ),
            },
          },
        ],
      }),
    });
  });
  await restore(page, info.project.name === 'pages');
  const metric = (name: string) =>
    page
      .locator('.monthly-metrics article')
      .filter({ has: page.getByText(name, { exact: true }) })
      .locator('strong');
  await expect(metric('尝试题数')).toHaveText('3');
  await expect(metric('提交量')).toHaveText('4');
  await expect(metric('确认比赛数')).toHaveText('1');
  await page.getByLabel('报告月份').fill(previousMonth);
  await expect(metric('提交量')).toHaveText('1');
  await page.getByLabel('报告月份').fill(month);
  await expect(metric('提交量')).toHaveText('4');
  await page.getByLabel('统计来源').selectOption('atcoder');
  await expect(metric('提交量')).toHaveText('1');
  await page.getByLabel('统计来源').selectOption('cf');
  await expect(metric('提交量')).toHaveText('3');
  await page.getByLabel('统计来源').selectOption('all');
  await expect(metric('提交量')).toHaveText('4');
  await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
  await expect(page.getByText('月度训练建议', { exact: true })).toBeVisible();
  await page.locator('.monthly-finding').filter({ hasText: '月度训练建议' }).locator('summary').click();
  await expect(
    page
      .locator('.monthly-finding')
      .filter({ hasText: '月度训练建议' })
      .getByText(/尝试 3 题/),
  ).toBeVisible();
  if (info.project.name === 'pages') {
    await page.context().setOffline(true);
    await page.getByRole('button', { name: '刷新报告', exact: true }).click();
    await expect(metric('提交量')).toHaveText('4');
    await expect(page.getByRole('heading', { name: '规则分析', exact: true })).toBeVisible();
    await page.context().setOffline(false);
  }
  await page.getByRole('link', { name: 'Monthly Contest', exact: true }).click();
  await expect(page).toHaveURL(/contest=cf%3A2000/);
  await page.goBack();
  await page.getByRole('button', { name: '月度报告', exact: true }).click();
  await expect(metric('提交量')).toHaveText('4');
  await page.reload();
  await page.getByRole('button', { name: '月度报告', exact: true }).click();
  await expect(metric('提交量')).toHaveText('4');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.switch-surface__veil, .page-scene')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('monthly-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
test('monthly empty state and unconfigured AI retain rule analysis', async ({ page }, info) => {
  await restore(page, info.project.name === 'pages', true);
  await expect(page.getByText('本月尚无已保存的提交或确认参赛记录。同步账号后可刷新报告。')).toBeVisible();
  await page.getByRole('button', { name: 'AI 解读', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '规则分析仍可使用' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '规则分析', exact: true })).toBeVisible();
  await expect(page.getByText('没有可用比较基准，不生成增长率。')).toBeVisible();
});
