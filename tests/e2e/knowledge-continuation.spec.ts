import { test, expect, type Page } from '@playwright/test';
import { prepare, target } from './helpers/knowledge';

async function switchAccount(page: Page, pages: boolean, handle: string) {
  await page.goto(target(pages, '/settings?view=accounts&platform=cf'));
  await page.getByRole('button', { name: handle, exact: true }).click();
  await expect(page.locator('.profile-chip')).toContainText(handle);
  await page.goto(target(pages, '/knowledge'));
  await expect(page.getByLabel('搜索知识与经验')).toBeVisible();
}

test('bookmarks and deliberate reading survive reload and remain account scoped', async ({ page }, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  const article = page.getByRole('article', { name: '知识正文' });
  const favorites = page.getByRole('navigation', { name: '收藏知识', exact: true });
  const recent = page.getByRole('navigation', { name: '最近阅读', exact: true });
  const directory = page.getByRole('navigation', { name: '知识目录', exact: true });

  await directory.locator('a[href*="card=binary-search"]').click();
  await article.getByRole('button', { name: '收藏知识', exact: true }).click();
  await expect(article.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(favorites.getByRole('link', { name: '二分答案', exact: true })).toBeVisible();
  await expect(recent.getByRole('link')).toHaveCount(1);
  await page.getByLabel('搜索知识与经验').fill('dp');
  await expect(article.getByRole('heading', { name: '动态规划', exact: true })).toBeVisible();
  await expect(recent.getByRole('link')).toHaveCount(1);
  await expect(recent.getByRole('link', { name: '动态规划', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await directory.locator('a[href*="card=two-pointers"]').click();
  await expect(recent.getByRole('link')).toHaveCount(2);
  await expect(recent.getByRole('link').first()).toContainText('双指针');
  await page.reload();
  await expect(favorites.getByRole('link', { name: '二分答案', exact: true })).toBeVisible();
  await expect(recent.getByRole('link').first()).toContainText('双指针');

  await switchAccount(page, pages, 'knowledge_other');
  await expect(favorites.getByRole('link')).toHaveCount(0);
  await expect(recent.getByRole('link')).toHaveCount(0);
  await switchAccount(page, pages, 'knowledge_reader');
  await expect(favorites.getByRole('link', { name: '二分答案', exact: true })).toBeVisible();
  await expect(recent.getByRole('link')).toHaveCount(2);
  await favorites.getByRole('link', { name: '二分答案', exact: true }).click();
  await article.getByRole('button', { name: '取消收藏', exact: true }).click();
  await page.reload();
  await expect(favorites.getByRole('link')).toHaveCount(0);
  await expect(article.getByRole('button', { name: '收藏知识', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({ path: info.outputPath('knowledge-shelf-mobile.png'), fullPage: true });
});

test('graph uses normalized knowledge aliases and can leave a neighborhood without losing the query', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  await page.goto(target(pages, '/knowledge?card=binary-search'));
  await page
    .getByRole('article', { name: '知识正文' })
    .getByRole('button', { name: '查看关联', exact: true })
    .click();
  const graph = page.getByRole('region', { name: '知识图谱', exact: true });
  const query = graph.getByLabel('检索图谱节点', { exact: true });
  const table = graph.getByRole('table');
  await expect(graph.getByRole('button', { name: '退出邻域，保留筛选', exact: true })).toBeVisible();
  await query.fill('ＢＩＮＡＲＹ　ＳＥＡＲＣＨ');
  await expect(table.getByRole('link', { name: '二分答案', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(graph.locator('.learning-table details')).toHaveCount(0);

  await query.fill('ＤＰ');
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await graph.getByRole('button', { name: '退出邻域，保留筛选', exact: true }).click();
  await expect(query).toHaveValue('ＤＰ');
  await expect(table.getByRole('link', { name: '动态规划', exact: true })).toBeVisible();
  await query.fill('unmatched-knowledge-node');
  await expect(table.locator('tbody tr')).toHaveCount(0);
  await graph.getByRole('button', { name: '重置并显示全部节点', exact: true }).click();
  await expect(query).toHaveValue('');
  await expect(table.getByRole('link', { name: '二分答案', exact: true })).toBeVisible();
  await expect(table.getByRole('link', { name: '边界笔记', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({ path: info.outputPath('knowledge-graph-mobile.png'), fullPage: true });
});

test('experience edits survive refresh, stay private to the account and clear after saving or cancelling', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  const cards = await prepare(page, pages);
  const editor = page.locator('#experience-editor');
  const pending = page.getByRole('region', { name: '待保存编辑', exact: true });
  await page.goto(target(pages, '/knowledge?experience=' + cards.boundary));
  await editor.getByLabel('标题', { exact: true }).fill('边界笔记 · 等待保存');
  await editor.getByLabel('经验内容', { exact: true }).fill('这份编辑需要在刷新和账号切换后仍能找回。');
  await expect(editor.getByText('编辑已暂存在本浏览器，刷新后可继续。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('边界笔记 · 等待保存');
  await expect(editor.getByLabel('经验内容', { exact: true })).toHaveValue(
    '这份编辑需要在刷新和账号切换后仍能找回。',
  );
  await editor.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page).not.toHaveURL(/experience=/);
  await expect(
    pending.getByRole('button', { name: '继续编辑：边界笔记 · 等待保存', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toHaveCount(0);
  await expect(
    pending.getByRole('button', { name: '继续编辑：边界笔记 · 等待保存', exact: true }),
  ).toBeVisible();

  await switchAccount(page, pages, 'knowledge_other');
  await expect(pending).toHaveCount(0);
  await expect(page.getByText('边界笔记 · 等待保存', { exact: true })).toHaveCount(0);
  await switchAccount(page, pages, 'knowledge_reader');
  await pending.getByRole('button', { name: '继续编辑：边界笔记 · 等待保存', exact: true }).click();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('边界笔记 · 等待保存');
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page).not.toHaveURL(/experience=/);
  await expect(pending).toHaveCount(0);
  await expect(
    page
      .locator('.knowledge-experiences article')
      .getByRole('heading', { name: '边界笔记 · 等待保存', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(editor).toHaveCount(0);
  await expect(pending).toHaveCount(0);

  await page.goto(target(pages, '/knowledge?experience=' + cards.boundary));
  await editor.getByLabel('标题', { exact: true }).fill('这一份编辑应被取消');
  await editor.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page).not.toHaveURL(/experience=/);
  await page.reload();
  await expect(editor).toHaveCount(0);
  await expect(pending).toHaveCount(0);
  await page.goto(target(pages, '/knowledge?experience=' + cards.boundary));
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('边界笔记 · 等待保存');
});

test('stale experience must be reconfirmed and edited cards do not offer a failing refresh', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  const cards = await prepare(page, pages);
  const experiences = page.locator('.knowledge-experiences article');
  await expect(experiences.first().getByRole('button', { name: '刷新草稿', exact: true })).toBeDisabled();
  await page.goto(target(pages, '/knowledge?experience=' + cards.stale));
  const editor = page.locator('#experience-editor');
  const confirmation = editor.getByLabel('我已核对内容及关联知识点，允许用于检索', { exact: true });
  await expect(confirmation).not.toBeChecked();
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const stale = experiences.filter({ has: page.getByRole('heading', { name: '旧匹配笔记', exact: true }) });
  await expect(stale.locator('.tag')).toHaveText('草稿');
  await page.getByLabel('搜索知识与经验').fill('strings');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(page.getByRole('region', { name: '检索结果' })).not.toContainText('旧匹配笔记');
  await stale.getByRole('button', { name: '编辑与确认', exact: true }).click();
  await confirmation.check();
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(stale.locator('.tag')).toHaveText('已确认');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(page.getByRole('region', { name: '检索结果' })).toContainText('旧匹配笔记');
});

test('a restored local edit requires review when the saved experience has changed', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'pages', 'This simulates another client updating the shared HTTP store.');
  const cards = await prepare(page, false);
  await page.goto('/knowledge?experience=' + cards.boundary);
  const editor = page.locator('#experience-editor');
  await editor.getByLabel('标题', { exact: true }).fill('本地未保存版本');
  await expect(editor.getByText('编辑已暂存在本浏览器，刷新后可继续。', { exact: true })).toBeVisible();
  const state = await (await page.request.get('/api/learning/state')).json();
  const saved = state.records.find((record: { id: string }) => record.id === cards.boundary);
  const response = await page.request.post('/api/learning/card', {
    headers: { 'X-Review-App': '1' },
    data: { ...saved, title: '另一个窗口已保存版本' },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('本地未保存版本');
  await expect(
    editor.getByText('这张卡的已保存版本发生变化。你的本地编辑已保留，请对照后再保存。', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('button', { name: '保存经验卡', exact: true })).toBeDisabled();
  await editor.getByText('查看当前已保存版本', { exact: true }).click();
  await expect(editor.getByText('另一个窗口已保存版本', { exact: true })).toBeVisible();
  await editor.getByLabel('我已对照当前版本，保存本地编辑', { exact: true }).check();
  await expect(editor.getByRole('button', { name: '保存经验卡', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    page
      .locator('.knowledge-experiences article')
      .getByRole('heading', { name: '本地未保存版本', exact: true }),
  ).toBeVisible();
});

test('unavailable browser storage preserves current editing and still allows an explicit save', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  const cards = await prepare(page, pages);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage is unavailable for this test', 'SecurityError');
      },
    });
  });
  await page.goto(target(pages, '/knowledge?card=binary-search&experience=' + cards.boundary));
  const article = page.getByRole('article', { name: '知识正文' });
  await article.getByRole('button', { name: '收藏知识', exact: true }).click();
  await expect(page.getByRole('region', { name: '我的知识书架' })).toContainText(
    '浏览器暂时无法保存阅读记录',
  );
  await expect(article.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  const editor = page.locator('#experience-editor');
  await editor.getByLabel('标题', { exact: true }).fill('存储不可用时手动保存');
  await expect(
    page.getByText('本地暂存失败，编辑仍保留在本页；请保存经验卡后再离开或刷新。', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('存储不可用时手动保存');
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .locator('.knowledge-experiences article')
      .getByRole('heading', { name: '存储不可用时手动保存', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
