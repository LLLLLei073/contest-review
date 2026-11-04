import { test, expect } from '@playwright/test';
import { Store } from '../../server/store';
import { BattleService } from '../../shared/battle-service';
import { AgentService } from '../../shared/agent-service';
import { ReviewWorkflowService } from '../../shared/review-workflow';
import type { AgentRecord } from '../../shared/agent-domain';
import { mockCodeforces } from '../browser-fixture';
import { acceptConfirm } from './helpers/confirm';

test('backup comparison, shared platform health and read-only continuation survive reload', async ({
  page,
}, info) => {
  const pages = info.project.name === 'pages',
    target = (path: string) => (pages ? './#' + path : path);
  const store = new Store(':memory:');
  store.activate('polish_test');
  store.markRecentChecked('polish_test');
  store.enrich(
    'polish_test',
    [],
    [],
    [{ contestId: 7700, index: 'A', name: 'Continue battle', rating: 1100, tags: ['dp'] }],
  );
  const battle = new BattleService(store);
  const session = (
    await battle.start({ handle: 'polish_test', skillId: 'dp', operationId: crypto.randomUUID() })
  ).session!;
  battle.command(session.id, {
    handle: 'polish_test',
    revision: session.revision,
    action: 'pause',
    operationId: crypto.randomUUID(),
  });
  const key = store.manualProblem('polish_test', {
    contestId: 9600,
    index: 'A',
    name: 'Resume reflection',
    rating: 1200,
    tags: [],
  });
  const agent = new AgentService(store);
  const chat = (await agent.route('sessions', 'POST', {
    context: { kind: 'problem', problemKey: key },
  })) as Extract<AgentRecord, { kind: 'session' }>;
  new ReviewWorkflowService(store).start(chat.id);
  const backup = store.backup();
  store.close();
  if (pages) await mockCodeforces(page);
  await page.goto(target('/settings?view=backup'));
  await page
    .getByLabel('选择备份文件')
    .setInputFiles({
      name: 'polish.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(page.getByRole('table', { name: '恢复前后数量对比' })).toContainText('引导复盘');
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await expect(page.locator('.profile-chip')).toContainText('polish_test');
  await page.goto(target('/'));
  await expect(page.getByRole('button', { name: '继续上次训练' })).toBeVisible();
  await page.getByRole('button', { name: '继续上次训练' }).click();
  await expect(page).toHaveURL(/companion.*workflowId=/);
  await expect(page.locator('.guided-stages')).toContainText('确认情境');
  await page.reload();
  await expect(page.locator('.guided-stages')).toContainText('确认情境');
  await page.goto(target('/'));
  await page.getByText(/其他未完成训练/).click();
  await page.getByRole('button', { name: /已暂停/ }).click();
  await expect(page).toHaveURL(/battle.*continue=1/);
  await expect(page.getByRole('button', { name: '继续连战', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '继续连战', exact: true })).toBeVisible();
  await page.goto(target('/settings?view=sync'));
  const panel = page.getByRole('region', { name: '平台同步状态' }).first();
  for (const name of ['Codeforces', 'AtCoder', '洛谷', 'XCPC']) await expect(panel).toContainText(name);
  await page.goto(target('/statistics?view=battles'));
  await expect(page.getByRole('heading', { name: '连战记录', exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});
