import { test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { acceptConfirm } from './helpers/confirm';
import { Store } from '../../server/store';
import { ProgramService } from '../../shared/program-service';
import { programNamespace } from '../../shared/program-domain';
import { localDay } from '../../shared/core-store';
import type { CFSubmission } from '../../shared/domain';

const wideCatalog = Array.from({ length: 120 }, (_, i) => ({
  contestId: 6600 + i,
  index: 'A',
  name: `Program ${i}`,
  rating: 800 + (i % 15) * 100,
  tags: i % 2 ? ['dp'] : ['greedy'],
}));

async function restore(page: Page, backup: { file: string; handle: string }) {
  await page.goto('/settings?view=backup');
  await page.getByLabel('选择备份文件').setInputFiles(backup.file);
  await page.getByRole('button', { name: '恢复此备份' }).click();
  await acceptConfirm(page);
  await page.locator('.profile-chip', { hasText: backup.handle }).waitFor();
}

function preset(handle: string, pastDays: number, acRatio: number, status: 'active' | 'completed') {
  const store = new Store(':memory:');
  store.activate(handle);
  store.enrich(handle, [], [], wideCatalog);
  const service = new ProgramService(store);
  const state = service.generate({ duration: 7, dailyCount: 8, focus: ['动态规划', '贪心与构造'] });
  const confirmed = service.confirm({ id: state.draft!.id });
  const program = confirmed.active!;
  const now = Date.now();
  let id = 7000;
  const days = program.days.map((day, i) => {
    if (i >= pastDays) return day;
    const date = localDay(new Date(now - (pastDays - i) * 86400000));
    for (const p of day.problems) {
      const pick = (i * 7 + day.problems.indexOf(p)) % 10 < acRatio * 10;
      if (!pick && status === 'active') continue;
      const [contestId, index] = p.key.split(':');
      const sub: CFSubmission = {
        id: id++,
        contestId: Number(contestId),
        creationTimeSeconds: Math.floor(Date.parse(date + 'T13:00:00+08:00') / 1000),
        problem: { contestId: Number(contestId), index, name: p.key, rating: 1200, tags: ['dp'] },
        verdict: 'OK',
        programmingLanguage: 'C++',
        author: { participantType: 'PRACTICE' },
      };
      store.ingest(handle, [sub]);
    }
    return { ...day, date };
  });
  store.externalPut(programNamespace(handle, ''), program.id, {
    ...program,
    days,
    status,
    finishedAt: status === 'completed' ? new Date().toISOString() : null,
    baselineMastery: [
      { name: '动态规划', score: 41, samples: 9 },
      { name: '实现与模拟', score: 50, samples: 9 },
      { name: '贪心与构造', score: 47, samples: 9 },
      { name: '数学', score: 55, samples: 9 },
      { name: '数据结构', score: 50, samples: 9 },
      { name: '图与树', score: 50, samples: 9 },
      { name: '字符串', score: 50, samples: 9 },
      { name: '搜索与技巧', score: 50, samples: 9 },
    ],
  });
  const backup = store.backup();
  store.close();
  return backup;
}

test('visual: wizard, preview, active+hint, completed report, mobile', async ({ page }, info) => {
  const out = (name: string) => info.outputPath(name);
  const write = (handle: string, data: unknown) => {
    const file = info.outputPath(handle + '.json');
    writeFileSync(file, JSON.stringify(data));
    return { file, handle };
  };
  // 1) 空态向导
  const emptyStore = new Store(':memory:');
  emptyStore.activate('vp_empty');
  emptyStore.enrich('vp_empty', [], [], wideCatalog);
  const emptyBackup = emptyStore.backup();
  emptyStore.close();
  await restore(page, write('vp_empty', emptyBackup));
  await page.goto('/?view=program');
  await page.locator('.program-wizard').waitFor();
  await page.screenshot({ path: out('1-wizard.png'), fullPage: true });

  // 2) 预览态（走真实 UI 生成流程，验证警告横幅与全部天数）
  const draftStore = new Store(':memory:');
  draftStore.activate('vp_draft');
  draftStore.enrich('vp_draft', [], [], wideCatalog);
  const draftBackup = draftStore.backup();
  draftStore.close();
  await restore(page, write('vp_draft', draftBackup));
  await page.goto('/?view=program');
  await page.getByRole('button', { name: '分析并生成全部 14 天预览' }).click();
  await page.locator('.program-day').first().waitFor();
  await page.locator('.program-generation-warnings').waitFor();
  await page.screenshot({ path: out('2-preview.png'), fullPage: true });

  // 3) 进行中 + 校准提示
  await restore(page, write('vp_active', preset('vp_active', 3, 1, 'active')));
  await page.goto('/?view=program');
  await page.locator('.program-hint').waitFor();
  await page.screenshot({ path: out('3-active.png'), fullPage: true });

  // 3b) 手机视口（active）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out('3b-active-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 4) 完成报告 + 雷达
  await restore(page, write('vp_done', preset('vp_done', 7, 0.9, 'completed')));
  await page.goto('/?view=program');
  await page.locator('.program-report').waitFor();
  await page.screenshot({ path: out('4-report.png'), fullPage: true });
});
