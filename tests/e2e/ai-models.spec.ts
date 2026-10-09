import { test, expect } from '@playwright/test';
test('AI settings automatically discovers models, preserves input and saves the selected model', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await page.route('https://models.test/**', (route) =>
    route.fulfill({
      json: { data: [{ id: 'fixture-model' }, { id: 'learning-fixture' }, { id: 'fixture-model' }] },
    }),
  );
  await page.goto(pages ? './#/settings?view=ai' : '/settings?view=ai');
  await page.getByLabel('模型名称', { exact: true }).fill('custom-chat');
  await page.getByLabel('接口地址 Base URL').fill('https://models.test/v1');
  await page.getByLabel('API 密钥', { exact: true }).fill('fixture-secret-key');
  const picker = page.getByLabel('可用模型', { exact: true });
  await expect(picker).toBeVisible();
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('custom-chat');
  await picker.selectOption('fixture-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(page.getByText('AI 配置已保存', { exact: true })).toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue('fixture-model');
  await expect(page.getByLabel('API 密钥', { exact: true })).toHaveValue('fixt…-key');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('ai-models-mobile.png'), fullPage: true });
});
test('model retrieval failure is retryable and an outdated response cannot override new credentials', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let requests = 0;
  await page.route(pages ? 'https://model-picker.test/**' : '**/api/ai/models', async (route) => {
    const key = pages
      ? new URL(route.request().url()).pathname
      : JSON.parse(route.request().postData()!).baseUrl;
    const ids = key.includes('slow') ? ['old-model'] : ['new-model'];
    requests++;
    if (key.includes('slow')) await held;
    if (key.includes('fail'))
      return route.fulfill({ status: 401, json: { error: 'API 密钥无效或无权获取模型' } });
    await route.fulfill({ json: pages ? { data: ids.map((id) => ({ id })) } : { models: ids } });
  });
  await page.goto(pages ? './#/settings?view=ai' : '/settings?view=ai');
  await page.getByLabel('API 密钥', { exact: true }).fill('test-new-key');
  await page.getByLabel('接口地址 Base URL').fill('https://model-picker.test/fail');
  await expect(page.locator('.ai-model-picker [role=alert]')).toContainText('密钥');
  await page.getByRole('button', { name: '重试获取模型' }).click();
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await page.getByLabel('模型名称', { exact: true }).fill('manual-model');
  await page.getByLabel('接口地址 Base URL').fill('https://model-picker.test/slow');
  await expect(page.getByText('正在获取模型列表…', { exact: true })).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThanOrEqual(3);
  await page.getByLabel('接口地址 Base URL').fill('https://model-picker.test/new');
  const picker = page.getByLabel('可用模型', { exact: true });
  await expect(picker.locator('option[value="new-model"]')).toHaveCount(1);
  const done = page.waitForResponse((r) =>
    pages
      ? r.url().includes('/slow/models')
      : r.url().endsWith('/api/ai/models') && r.request().postData()!.includes('/slow'),
  );
  release();
  await done;
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(picker.locator('option[value="old-model"]')).toHaveCount(0);
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveValue('manual-model');
});
