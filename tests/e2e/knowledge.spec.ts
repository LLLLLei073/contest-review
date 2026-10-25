import { test, expect, type Page } from '@playwright/test';
import { Store } from '../../server/store';
import { LearningService } from '../../shared/learning-service';

const target = (pages: boolean, path: string) => (pages ? './#' + path : path);

async function prepare(page: Page, pages: boolean) {
  const store = new Store(':memory:');
  store.activate('knowledge_reader');
  const learning = new LearningService(store);
  const cards: Record<string, string> = {};
  const entries = [
    { id: 'boundary', title: '边界笔记', tag: 'binary search', skill: 'binary-search', confirmed: true },
    { id: 'window', title: '窗口笔记', tag: 'two pointers', skill: 'two-pointers', confirmed: true },
    { id: 'draft', title: '滚动数组草稿', tag: 'dp', skill: 'dp', confirmed: false },
    { id: 'stale', title: '旧匹配笔记', tag: 'strings', skill: 'string', confirmed: true },
  ];
  for (const [index, entry] of entries.entries()) {
    const key = store.manualProblem('knowledge_reader', {
      contestId: 8100 + index,
      index: 'A',
      name: 'Knowledge Source ' + entry.id,
      rating: 1200,
      tags: [entry.tag],
    });
    store.saveReview('knowledge_reader', key, {
      ...store.review('knowledge_reader', key),
      rootCause: entry.id + ' source observation',
      solution: '先写不变量，再用最小反例验证。',
    });
    const draft = await learning.draft({ problemKey: key });
    const card = await learning.editCard({
      ...draft,
      title: entry.title,
      // The algorithm names exist only in knowledgeIds. Both library and document
      // retrieval must follow those associations rather than depending on prose.
      content: '检查空输入和单元素，记录自己的最小反例。',
      knowledgeIds: [entry.skill],
      confirmed: entry.confirmed,
    });
    cards[entry.id] = card.id;
    if (entry.id === 'stale') {
      store.saveReview('knowledge_reader', key, {
        ...store.review('knowledge_reader', key),
        rootCause: '来源已经更新，旧卡需要重新核对。',
      });
    }
  }
  store.markRecentChecked('knowledge_reader');
  const backup = store.backup();
  store.close();
  await page.goto(target(pages, '/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'knowledge.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await expect(page.locator('.profile-chip')).toContainText('knowledge_reader');
  await page.goto(target(pages, '/knowledge'));
  await expect(page.getByLabel('搜索知识与经验')).toBeVisible();
  const reward = page.getByRole('button', { name: '关闭成长奖励', exact: true });
  if (await reward.isVisible()) await reward.click();
  return cards;
}

test('knowledge filters include personal associations and preserve the reading context', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  const query = page.getByLabel('搜索知识与经验');
  const directory = page.getByRole('navigation', { name: '知识目录' });
  const experiences = page.locator('.knowledge-experiences article');

  await query.fill('ＢＩＮＡＲＹ　ＳＥＡＲＣＨ');
  await expect(directory.getByRole('link')).toHaveCount(1);
  await expect(directory).toContainText('二分答案');
  await expect(experiences).toHaveCount(1);
  await expect(experiences.first()).toContainText('边界笔记');

  await query.fill('dp');
  await expect(experiences).toHaveCount(1);
  await expect(experiences.first()).toContainText('滚动数组草稿');
  await page.getByLabel('经验状态').selectOption('confirmed');
  await expect(experiences).toHaveCount(0);
  await page.getByLabel('经验状态').selectOption('draft');
  await expect(experiences).toHaveCount(1);

  await query.fill('');
  await page.getByLabel('经验状态').selectOption('stale');
  await expect(experiences).toHaveCount(1);
  await expect(experiences.first()).toContainText('旧匹配笔记');
  await page.getByLabel('算法领域').selectOption('动态规划');
  await expect(experiences).toHaveCount(0);

  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await page.getByLabel('算法领域').selectOption('数据结构');
  await query.fill('数据结构');
  await expect(directory.getByRole('link')).toHaveCount(2);
  await directory.getByRole('link', { name: /线段树/ }).click();
  await expect(page.getByRole('article', { name: '知识正文' })).toContainText('线段树');
  await expect(query).toHaveValue('数据结构');
  await expect(page.getByLabel('算法领域')).toHaveValue('数据结构');
  await directory.getByRole('link', { name: /二分答案/ }).click();
  await page.goBack();
  await expect(directory.getByRole('link', { name: /线段树/ })).toHaveAttribute('aria-current', 'page');
  await expect(query).toHaveValue('数据结构');

  await query.fill('zzqv-no-matching-material');
  await expect(directory).toHaveCount(0);
  await expect(experiences).toHaveCount(0);
  await expect(page.getByText(/没有匹配的内置知识/)).toBeVisible();
  await page.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(query).toHaveValue('');
  await expect(page.getByLabel('算法领域')).toHaveValue('all');
  await expect(page.getByLabel('经验状态')).toHaveValue('all');
  await expect(directory.getByRole('link')).toHaveCount(14);
  await expect(experiences).toHaveCount(4);
});

test('knowledge reading connects lessons, practice and exact experience sources', async ({ page }, info) => {
  const pages = info.project.name === 'pages';
  const cards = await prepare(page, pages);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(target(pages, '/knowledge?card=binary-search'));
  const article = page.getByRole('article', { name: '知识正文' });
  for (const heading of ['适用信号', '解题步骤', '易错点', '自检练习', '关联个人经验']) {
    await expect(article.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(article).toContainText('边界笔记');
  await expect(article.getByRole('link', { name: '开始连战 →', exact: true })).toHaveAttribute(
    'href',
    /\/battle\?skill=binary-search/,
  );
  await expect(article.getByRole('link', { name: '查看学习路径 →', exact: true })).toHaveAttribute(
    'href',
    /view=path/,
  );
  await page.screenshot({ path: info.outputPath('knowledge-desktop.png'), fullPage: true });
  await page.screenshot({ path: info.outputPath('knowledge-desktop-viewport.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.screenshot({ path: info.outputPath('knowledge-mobile.png'), fullPage: true });
  await page.screenshot({ path: info.outputPath('knowledge-mobile-viewport.png') });
  await page.getByRole('button', { name: '切换为深色模式', exact: true }).click();
  await page.screenshot({ path: info.outputPath('knowledge-dark.png'), fullPage: true });
  await page.getByRole('button', { name: '切换为明亮模式', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('navigation', { name: '知识目录' }).locator('a[href*="card=simulation"]').click();
  await expect(article.getByRole('heading', { name: '后续知识', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '知识图谱', exact: true }).click();
  let table = page.getByRole('table');
  await table.getByRole('link', { name: '边界笔记', exact: true }).click();
  await expect(page.getByRole('button', { name: '知识与经验', exact: true })).toHaveClass(/active/);
  await expect(page.locator('#experience-editor').getByLabel('标题', { exact: true })).toHaveValue(
    '边界笔记',
  );
  await page.locator('#experience-editor').getByLabel('标题', { exact: true }).fill('边界笔记 · 未保存编辑');
  await page.getByRole('button', { name: '知识图谱', exact: true }).click();
  table = page.getByRole('table');
  await table.getByRole('link', { name: '窗口笔记', exact: true }).click();
  await expect(page.locator('#experience-editor').getByLabel('标题', { exact: true })).toHaveValue(
    '窗口笔记',
  );
  await expect(page).toHaveURL(new RegExp('experience=' + cards.window));
  await page.getByRole('button', { name: '知识图谱', exact: true }).click();
  await page.getByRole('table').getByRole('link', { name: '边界笔记', exact: true }).click();
  await expect(page.locator('#experience-editor').getByLabel('标题', { exact: true })).toHaveValue(
    '边界笔记 · 未保存编辑',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page.goto(target(pages, '/knowledge?card=missing-knowledge'));
  await expect(page.getByText(/知识点不存在/)).toBeVisible();
  await page.getByRole('navigation', { name: '知识目录' }).locator('a[href*="card=binary-search"]').click();
  await expect(page.getByText(/知识点不存在/)).toHaveCount(0);
  await expect(article.getByRole('heading', { name: '二分答案', exact: true })).toBeVisible();
  await page.goto(target(pages, '/knowledge?experience=missing-card'));
  await expect(page.getByText(/经验卡不存在或已删除/)).toBeVisible();
  await expect(page.locator('#experience-editor')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('retrieval clears obsolete results and excludes unconfirmed or stale experience documents', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages';
  await prepare(page, pages);
  const query = page.getByLabel('搜索知识与经验');
  const results = page.getByRole('region', { name: '检索结果' });
  await query.fill('binary search');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(results).toBeVisible();
  await expect(results).toContainText('边界笔记');
  await query.fill('dp');
  await expect(results).toHaveCount(0);
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(results).toBeVisible();
  await expect(results).not.toContainText('滚动数组草稿');
  await query.fill('strings');
  await page.getByRole('button', { name: '检索资料', exact: true }).click();
  await expect(results).toBeVisible();
  await expect(results).not.toContainText('旧匹配笔记');
});

test('a late experience save keeps a different card editor open', async ({ page }, info) => {
  test.skip(info.project.name === 'pages', 'Pages uses the browser adapter without an HTTP save request.');
  const cards = await prepare(page, false);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseResponse!: () => void;
  const gate = new Promise<void>((resolve) => (releaseResponse = resolve));
  let responseReady = false;
  await page.route('**/api/learning/card', async (route) => {
    // Commit the server mutation, but hold its response until the user has
    // cancelled this editor and opened another card.
    const response = await route.fetch();
    responseReady = true;
    await gate;
    await route.fulfill({ response });
  });

  await page.goto('/knowledge?experience=' + cards.boundary);
  const editor = page.locator('#experience-editor');
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('边界笔记');
  await editor.getByLabel('标题', { exact: true }).fill('边界笔记 · 已提交');
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  await expect.poll(() => responseReady).toBe(true);
  await editor.getByRole('button', { name: '取消编辑', exact: true }).click();
  await page
    .locator('.knowledge-experiences article')
    .filter({ has: page.getByRole('heading', { name: '窗口笔记', exact: true }) })
    .getByRole('button', { name: '编辑与确认', exact: true })
    .click();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('窗口笔记');
  releaseResponse();
  await expect(editor.getByRole('button', { name: '保存经验卡', exact: true })).toBeEnabled();
  await expect(editor.getByLabel('标题', { exact: true })).toHaveValue('窗口笔记');
  await expect(page).toHaveURL(new RegExp('experience=' + cards.window));
  await expect(page.getByText('边界笔记 · 已提交', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a late save preserves newer unsaved edits after switching away and returning', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'pages', 'Pages uses the browser adapter without an HTTP save request.');
  const cards = await prepare(page, false);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseResponse!: () => void;
  const gate = new Promise<void>((resolve) => (releaseResponse = resolve));
  let responseReady = false;
  await page.route('**/api/learning/card', async (route) => {
    const response = await route.fetch();
    responseReady = true;
    await gate;
    await route.fulfill({ response });
  });

  await page.goto('/knowledge?experience=' + cards.boundary);
  const editor = page.locator('#experience-editor');
  const title = editor.getByLabel('标题', { exact: true });
  await expect(title).toHaveValue('边界笔记');
  await title.fill('边界笔记 · 已提交 A1');
  await editor.getByRole('button', { name: '保存经验卡', exact: true }).click();
  try {
    await expect.poll(() => responseReady).toBe(true);
    await title.fill('边界笔记 · 后续未保存 A2');
    await page
      .locator('.knowledge-experiences article')
      .filter({ has: page.getByRole('heading', { name: '窗口笔记', exact: true }) })
      .getByRole('button', { name: '编辑与确认', exact: true })
      .click();
    await expect(title).toHaveValue('窗口笔记');
  } finally {
    releaseResponse();
  }
  await expect(editor.getByRole('button', { name: '保存经验卡', exact: true })).toBeEnabled();
  const savedCard = page
    .locator('.knowledge-experiences article')
    .filter({ has: page.getByRole('heading', { name: '边界笔记 · 已提交 A1', exact: true }) });
  await expect(savedCard).toBeVisible();
  await savedCard.getByRole('button', { name: '编辑与确认', exact: true }).click();
  await expect(title).toHaveValue('边界笔记 · 后续未保存 A2');
  await expect(page).toHaveURL(new RegExp('experience=' + cards.boundary));
  expect(errors).toEqual([]);
});
