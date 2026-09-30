import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import { localDay } from '../../shared/core-store';
import type { CFSubmission } from '../../shared/domain';

test('restored legacy review state shows completed evaluation and explains incomplete notes', async ({
  page,
}, info) => {
  const store = new Store(':memory:');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const submitted = (id: number, index: string, verdict: string): CFSubmission => ({
    id,
    contestId: 2000,
    creationTimeSeconds: Math.floor(now.getTime() / 1000),
    problem: { contestId: 2000, index, name: `Legacy ${index}`, rating: 1300, tags: ['math'] },
    verdict,
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  });
  store.activate('legacy_review');
  store.ingest('legacy_review', [submitted(1, 'A', 'WRONG_ANSWER'), submitted(2, 'B', 'WRONG_ANSWER')]);
  store.trainingDay('legacy_review', now);
  store.ingest('legacy_review', [submitted(3, 'A', 'OK'), submitted(4, 'B', 'OK')]);
  store.saveReview('legacy_review', '2000:A', {
    ...store.review('legacy_review', '2000:A'),
    solution: '分析后找到解法',
  });
  store.saveReview('legacy_review', '2000:B', {
    ...store.review('legacy_review', '2000:B'),
    reasons: ['边界遗漏'],
    code: 'int main() {}',
  });
  store.attempt('legacy_review', '2000:A', { result: 'independent', minutes: 10, note: '' }, now);
  const evaluated = store.review('legacy_review', '2000:A');
  store.put('reviews', 'legacy_review', '2000:A', {
    ...evaluated,
    awaitingEvaluation: {
      date: localDay(now),
      submissionId: 3,
      redoAt: now.toISOString(),
      previousNextReview: evaluated.nextReview,
    },
    nextReview: null,
    firstReflectionAt: null,
  });
  const backup = store.backup();
  store.close();

  if (info.project.name === 'pages')
    await page.route('https://codeforces.com/api/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'OK', result: [] }),
      }),
    );
  await page.goto(info.project.name === 'pages' ? './#/settings' : '/settings');
  await page.getByRole('button', { name: '备份与恢复' }).first().click();
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'legacy-review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await page.getByRole('link', { name: '今日题单', exact: true }).click();
  const reviewed = page.locator('.daily-panel').first().locator('.daily-task');
  await expect(reviewed).toHaveCount(2);
  await expect(reviewed.nth(0)).toHaveAttribute('data-phase', 'done');
  await expect(reviewed.nth(1)).toHaveAttribute('data-phase', 'reflection');
  await expect(page.getByRole('progressbar', { name: '今日复习进度' })).toHaveAttribute('aria-valuenow', '1');
  await expect(reviewed.nth(1)).toContainText('仅选错因或保存代码不计入');
  await page.reload();
  await expect(reviewed.nth(0)).toHaveAttribute('data-phase', 'done');
  await expect(page.getByRole('progressbar', { name: '今日复习进度' })).toHaveAttribute('aria-valuenow', '1');
});
