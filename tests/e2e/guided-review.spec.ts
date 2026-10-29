import { test, expect } from '@playwright/test';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
import { mockCodeforces } from '../browser-fixture';
import { guidedReply } from '../guided-fixture';
test('guided review persists checkpoints, separates hypotheses and finishes without inventing mastery', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages',
    target = (path: string) => (pages ? './#' + path : path);
  const store = new Store(':memory:');
  store.activate('guided_browser');
  store.manualProblem('guided_browser', {
    contestId: 9600,
    index: 'A',
    name: 'Guided boundary',
    tags: ['binary search'],
    rating: 1200,
  });
  store.externalPut('ai', 'config', {
    baseUrl: 'https://guided.fixture/v1',
    apiKey: 'fixture',
    model: 'fixture',
  });
  const backup = store.backup();
  store.close();
  if (pages) {
    await mockCodeforces(page);
    await page.route('https://guided.fixture/v1/chat/completions', async (route) => {
      const request = route.request().postDataJSON(),
        message = guidedReply(request);
      const tool = 'tool_calls' in message ? message.tool_calls : undefined;
      if (request.stream) {
        const delta = tool
          ? { role: 'assistant', tool_calls: tool.map((t, i) => ({ ...t, index: i })) }
          : { role: 'assistant', content: message.content };
        const chunk = {
          id: 'guided',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta, finish_reason: null }],
        };
        await route.fulfill({
          contentType: 'text/event-stream',
          body:
            'data: ' +
            JSON.stringify(chunk) +
            '\n\ndata: ' +
            JSON.stringify({
              ...chunk,
              choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
            }) +
            '\n\ndata: [DONE]\n\n',
        });
      } else
        await route.fulfill({
          json: {
            id: 'guided',
            choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message }],
          },
        });
    });
  } else
    await page.route('**/api/training/recent', (r) =>
      r.fulfill({ json: { checkedAt: new Date().toISOString(), error: null } }),
    );
  await page.goto(target('/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'guided.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('guided_browser');
  await page.goto(target('/problems/9600%3AA?view=guided'));
  await page.getByRole('button', { name: '开始引导复盘' }).click();
  await expect(page.getByLabel('我的回答')).toBeVisible();
  await expect(page.getByText('已读取题目与二分资料；尚无本机运行报告。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('我的回答')).toBeVisible();
  await page.getByText(/公开依据与待验证假设/).click();
  await expect(page.locator('.guided-evidence .badge').filter({ hasText: '待验证假设' })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('我的回答').fill('当前已核对边界，运行报告仍未提供。');
    await page.getByRole('button', { name: '保存回答并继续' }).click();
    if (i < 5)
      await expect(page.locator('.guided-stages [aria-current="step"]')).toContainText(
        ['回忆过程', '查证原因', '验证假设', '沉淀复盘', '迁移与安排'][i],
      );
    await expect(page.getByRole('button', { name: '停止引导' })).toHaveCount(0);
  }
  await expect(page.getByText('本次引导已结束', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复盘笔记', exact: true }).click();
  await expect(page.getByLabel('正确解法', { exact: false })).toHaveValue('');
  await page.getByRole('button', { name: '引导复盘', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('guided-mobile.png'), fullPage: true });
});
