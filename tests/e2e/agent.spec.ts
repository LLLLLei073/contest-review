import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import { mockCodeforces } from '../browser-fixture';
function fixture() {
  const s = new Store(':memory:');
  s.activate('astra_browser');
  s.manualProblem('astra_browser', {
    contestId: 9900,
    index: 'A',
    name: 'Astra fixture',
    tags: ['math'],
    rating: 1000,
  });
  s.externalPut('ai', 'config', { baseUrl: 'https://astra.fixture/v1', apiKey: 'fixture', model: 'fixture' });
  const b = s.backup();
  s.close();
  return b;
}
test('Astra chat, streamed tools, managed memory, account isolation and offline history at both sizes', async ({
  page,
  context,
}, info) => {
  const pages = info.project.name === 'pages';
  const target = (p: string) => (pages ? './#' + p : p);
  const errors: string[] = [];
  let failureSeen = false;
  page.on('pageerror', (e) => errors.push(e.message));
  if (pages) {
    await mockCodeforces(page);
    await page.route('https://astra.fixture/v1/chat/completions', async (r) => {
      const data = r.request().postDataJSON();
      const user = String(data.messages.findLast((m: { role: string }) => m.role === 'user')?.content);
      if (user.includes('暂停测试')) await new Promise((resolve) => setTimeout(resolve, 800));
      if (user.includes('模拟失败') && !failureSeen) {
        failureSeen = true;
        await r.fulfill({ status: 503, json: { error: { message: '模拟网络失败' } } });
        return;
      }
      const final = data.messages.at(-1)?.role === 'tool';
      const content = '星澪已查询真实学习记录。我们先讲直觉，再讲证明。';
      const change = user.includes('修改复盘');
      const tool = {
        id: 'snapshot',
        type: 'function',
        function: {
          name: change ? 'propose_change' : 'learning_snapshot',
          arguments: change
            ? JSON.stringify({
                action: 'review',
                input: { problemKey: '9900:A', patch: { rootCause: '星澪帮助确认边界' } },
              })
            : '{}',
        },
      };
      if (data.stream) {
        const chunks = final
          ? [{ role: 'assistant', content: content.slice(0, 12) }, { content: content.slice(12) }]
          : [{ role: 'assistant', tool_calls: [{ ...tool, index: 0 }] }];
        const body =
          chunks
            .map(
              (delta) =>
                'data: ' +
                JSON.stringify({
                  id: 'chat-fixture',
                  object: 'chat.completion.chunk',
                  created: 1,
                  model: 'fixture',
                  choices: [{ index: 0, delta, finish_reason: null }],
                }) +
                '\n\n',
            )
            .join('') +
          'data: ' +
          JSON.stringify({
            id: 'chat-fixture',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture',
            choices: [{ index: 0, delta: {}, finish_reason: final ? 'stop' : 'tool_calls' }],
          }) +
          '\n\ndata: [DONE]\n\n';
        await r.fulfill({
          contentType: 'text/event-stream',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body,
        });
      } else
        await r.fulfill({
          json: {
            id: 'chat-fixture',
            choices: [
              {
                index: 0,
                finish_reason: final ? 'stop' : 'tool_calls',
                message: final
                  ? { role: 'assistant', content }
                  : { role: 'assistant', content: '', tool_calls: [tool] },
              },
            ],
          },
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
    });
  } else
    await page.route('**/api/training/recent', (r) =>
      r.fulfill({ json: { checkedAt: new Date().toISOString(), error: null } }),
    );
  await page.goto(target('/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'astra.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('astra_browser');
  await page.goto(target('/companion'));
  await expect(page.getByRole('heading', { name: '与星澪同行' })).toBeVisible();
  await page.getByLabel('发送给星澪的消息').fill('请记住：我更喜欢先讲直觉再讲证明');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.astra-message.assistant')).toContainText('星澪已查询真实学习记录');
  await page.getByRole('button', { name: '记忆与偏好' }).click();
  await expect(page.getByLabel('已记住的偏好')).toHaveValue('我更喜欢先讲直觉再讲证明');
  await page.getByLabel('已记住的偏好').fill('先讲直觉，再讲证明');
  await page.getByRole('button', { name: '保存记忆' }).click();
  await expect(page.getByText('星澪记忆已保存', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '记忆与偏好' }).click();
  await expect(page.getByLabel('已记住的偏好')).toHaveValue('先讲直觉，再讲证明');
  await expect(page.getByLabel('开启站内主动建议')).not.toBeChecked();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('astra-' + width + '.png'), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('发送给星澪的消息').focus();
  await expect(page.getByLabel('发送给星澪的消息')).toBeFocused();
  if (pages) {
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.astra-message.assistant')).toContainText('星澪已查询真实学习记录');
    await context.setOffline(false);
    await page.getByRole('button', { name: '记忆与偏好' }).click();
  }
  await page.getByRole('button', { name: '删除记忆' }).click();
  await expect(page.getByLabel('已记住的偏好')).toHaveCount(0);
  await page.getByLabel('发送给星澪的消息').fill('请修改复盘笔记');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.astra-proposal').last()).toContainText('星澪帮助确认边界');
  await page.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.locator('.astra-proposal').last()).toContainText('已执行');
  await page.getByLabel('发送给星澪的消息').fill('再提出一个修改复盘方案');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.locator('.astra-proposal').last()).toContainText('已拒绝');
  await page.getByLabel('发送给星澪的消息').fill('模拟失败');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试上条消息' })).toBeVisible();
  await page.getByRole('button', { name: '重试上条消息' }).click();
  await expect(page.locator('.astra-message.assistant').last()).toContainText('星澪已查询真实学习记录');
  await page.getByLabel('发送给星澪的消息').fill('暂停测试');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '停止生成' }).click();
  await page.getByLabel('发送给星澪的消息').fill('停止后再次查看进度');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.astra-message.assistant').last()).toContainText('星澪已查询真实学习记录');
  await page.goto(target('/settings?view=accounts'));
  await page.getByRole('button', { name: 'Codeforces', exact: true }).click();
  await page.getByLabel('Codeforces Handle', { exact: true }).fill('astra_other');
  await page.getByRole('button', { name: '绑定用户名', exact: true }).click();
  await expect(page.locator('.profile-chip')).toContainText('astra_other');
  await page.goto(target('/companion'));
  await expect(page.locator('.astra-message')).toHaveCount(0);
  expect(errors).toEqual([]);
});
