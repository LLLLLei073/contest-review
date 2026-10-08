import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import { learningReply } from '../learning-fixture';
import type { CFSubmission } from '../../shared/domain';
import { fingerprint } from '../../shared/learning-domain';

function backup() {
  const s = new Store(':memory:');
  s.activate('learning_tester');
  const key = s.manualProblem('learning_tester', {
    contestId: 2000,
    index: 'A',
    name: 'Learning Fixture',
    rating: 1000,
    tags: ['binary search'],
  });
  s.saveReview('learning_tester', key, {
    ...s.review('learning_tester', key),
    rootCause: '二分边界遗漏',
    solution: '先证明循环不变量',
    code: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n;}',
    language: 'cpp',
  });
  s.ingest('learning_tester', [
    {
      id: 1,
      contestId: 2000,
      creationTimeSeconds: Math.floor(Date.now() / 1000),
      problem: {
        contestId: 2000,
        index: 'A',
        name: 'Learning Fixture',
        rating: 1000,
        tags: ['binary search'],
      },
      verdict: 'WRONG_ANSWER',
      programmingLanguage: 'C++',
      author: { participantType: 'PRACTICE' },
    } as CFSubmission,
  ]);
  s.enrich(
    'learning_tester',
    [],
    [],
    Array.from({ length: 35 }, (_, i) => ({
      contestId: 3000 + i,
      index: 'A',
      name: 'Learning Candidate ' + i,
      rating: 1100 + (i % 3) * 100,
      tags: ['math', 'binary search'],
    })),
  );
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, tomorrow);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] });
  s.externalPut('ai', 'config', {
    baseUrl: 'https://learning-ai.test/v1',
    apiKey: 'fixture',
    model: 'learning-fixture',
  });
  const data = s.backup();
  s.close();
  return data;
}
test('learning loop: draft, confirm, RAG, graph, diagnosis, next-day agent, hints, stress and migration', async ({
  page,
}, info) => {
  await page.route('https://learning-ai.test/v1/chat/completions', async (route) => {
    const req = route.request().postDataJSON();
    const reply = learningReply(req.messages[0].content, JSON.parse(req.messages[1].content));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(info.project.name === 'pages' ? './#/settings' : '/settings');
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'learning.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup())),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('learning_tester');
  await page.goto(info.project.name === 'pages' ? './#/problems/2000%3AA' : '/problems/2000%3AA');
  await page.getByRole('button', { name: '学习闭环', exact: true }).click();
  await page.getByRole('button', { name: '生成经验卡草稿' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已完成' })).toBeVisible();
  await page.getByRole('link', { name: '知识与经验库' }).click();
  await expect(page.locator('.breadcrumb')).toContainText('知识中心');
  await page.getByRole('button', { name: '编辑与确认' }).click();
  await page.getByLabel('我已核对内容及关联知识点，允许用于检索').check();
  await page.getByRole('button', { name: '保存经验卡' }).click();
  await expect(page.getByText('已确认', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'RAG 问答', exact: true }).click();
  await page.getByLabel('向算法助手提问').fill('二分边界');
  await page.getByRole('button', { name: '检索并回答' }).click();
  await expect(page.getByText('资料显示需要先证明循环不变量，并检查边界。')).toBeVisible();
  await page.getByRole('button', { name: '知识图谱', exact: true }).click();
  await expect(page.getByRole('img', { name: '算法知识关系图' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Learning Fixture');
  await page.getByRole('button', { name: '学情诊断', exact: true }).click();
  await page.getByRole('button', { name: '生成学情诊断' }).click();
  await expect(page.getByText('证据显示需要复核边界条件。')).toBeVisible();
  await page.getByRole('button', { name: '训练 Agent', exact: true }).click();
  await expect(page.getByLabel('自动调整次日计划（仅在应用运行时触发）')).not.toBeChecked();
  await page.getByRole('button', { name: '生成次日计划' }).click();
  await expect(page.getByText('调整后：', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '撤回此版本' }).click();
  await expect(page.getByRole('heading', { name: /已撤回/ })).toBeVisible();
  await page.goto(info.project.name === 'pages' ? './#/problems/2000%3AA' : '/problems/2000%3AA');
  await page.getByRole('button', { name: '学习闭环', exact: true }).click();
  await page.getByLabel('题面与输入输出约束').fill('输入一个整数 n，1<=n<=10，输出 2*n。');
  await page.getByRole('button', { name: '1. 方向提示' }).click();
  await expect(page.locator('summary').filter({ hasText: '第 1 级' })).toBeVisible();
  await page.getByRole('button', { name: '生成对拍包' }).click();
  await expect(page.getByText('AI 建议 · 未运行')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载对拍 ZIP' }).click();
  const archive = await download;
  expect(archive.suggestedFilename()).toMatch(/\.zip$/);
  await archive.saveAs(info.outputPath('stress-bundle.zip'));
  const bundleId = archive.suggestedFilename().slice(7, -4);
  await page
    .getByLabel('导入本机对拍报告')
    .setInputFiles({
      name: 'report.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'contest-review-stress',
          version: 1,
          bundleId,
          codeHash: fingerprint('#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n;}'),
          seed: 1,
          rounds: 1,
          round: 1,
          status: 'mismatch',
          input: '3\n',
          expected: '6',
          actual: '3',
          message: '输出不同',
        }),
      ),
    });
  await expect(page.getByText('用户报告已验证', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '安排迁移检测' }).click();
  await page.getByRole('link', { name: '查看迁移任务与评价' }).click();
  await expect(page.getByRole('button', { name: '独立完成', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '未完成', exact: true }).click();
  await expect(page.getByText('结果：未完成')).toBeVisible();
  await page.reload();
  await expect(page.getByText('结果：未完成')).toBeVisible();
  await page.getByRole('button', { name: 'RAG 问答', exact: true }).click();
  await page.getByLabel('向算法助手提问').fill('二分循环不变量');
  await page.getByRole('button', { name: '检索并回答' }).click();
  await expect(page.getByText('资料显示需要先证明循环不变量，并检查边界。')).toHaveCount(2);
  await expect(page.getByLabel('向算法助手提问')).toBeVisible();
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath('learning-loop.png'), fullPage: true });
});
