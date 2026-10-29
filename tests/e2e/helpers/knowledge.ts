import { expect, type Page } from '@playwright/test';
import { acceptConfirm } from './confirm';
import { Store } from '../../../server/store';
import { LearningService } from '../../../shared/learning-service';

export const target = (pages: boolean, path: string) => (pages ? './#' + path : path);

export async function prepare(page: Page, pages: boolean) {
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
  store.activate('knowledge_other');
  store.markRecentChecked('knowledge_other');
  store.activate('knowledge_reader');
  const backup = store.backup();
  store.close();
  await page.goto(target(pages, '/settings?view=backup'));
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'knowledge.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  // 账号名恢复前后相同，profile-chip 会立即通过；必须等恢复真正提交完成，
  // 否则紧随的深链跳转会读到旧数据（experience 卡 id 对不上）。
  await expect(page.getByText(/恢复成功|备份恢复完成/).first()).toBeVisible();
  await expect(page.locator('.profile-chip')).toContainText('knowledge_reader');
  await page.goto(target(pages, '/knowledge'));
  await expect(page.getByLabel('搜索知识与经验')).toBeVisible();
  const reward = page.getByRole('button', { name: '关闭成长奖励', exact: true });
  if (await reward.isVisible()) await reward.click();
  return cards;
}
