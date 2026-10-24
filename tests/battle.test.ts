import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { buildApp } from '../server/app';
import { BattleService, allBattleRewards } from '../shared/battle-service';
import { mapTheme, parseThemeAi, themeMapping } from '../shared/battle-theme';
import { battleFacts, savedSummary } from '../shared/battle-summary';
import { PlanningService } from '../shared/planning-service';
import { DEFAULT_BKT, updateKnowledge } from '../shared/knowledge-tracing';
import { TrainingService } from '../shared/training-service';
import { validateBattle, type BattleSession } from '../shared/battle-domain';
import type { CFSubmission } from '../shared/domain';
import { buildLearningPath } from '../shared/learning-path';
import { knowledgeCards } from '../shared/knowledge';
import { buildInsights } from '../shared/insights';
import { monthlyReport } from '../shared/monthly-report';

function fixture() {
  const store = new Store(':memory:');
  store.activate('battle_tester');
  let now = new Date('2026-10-23T04:00:00Z');
  store.enrich(
    'battle_tester',
    [],
    [],
    Array.from({ length: 40 }, (_, i) => ({
      contestId: 7000 + i,
      index: 'A',
      name: 'Battle ' + i,
      rating: 1100,
      tags: i < 35 ? ['dp', 'implementation'] : ['math'],
    })),
  );
  const service = new BattleService(store, () => now);
  const planner = new PlanningService(store, () => now);
  const start = () =>
    service.start({ handle: 'battle_tester', skillId: 'dp', operationId: crypto.randomUUID() });
  const cmd = (action: string, extra: Record<string, unknown> = {}) => {
    const s = service.state().session!;
    return service.command(s.id, {
      handle: 'battle_tester',
      revision: s.revision,
      operationId: crypto.randomUUID(),
      action,
      ...extra,
    });
  };
  let subId = 100;
  const accept = (overrides: Partial<CFSubmission> = {}) => {
    const item = service.state().session!.items.find((i) => i.outcome === 'current')!;
    now = new Date(now.getTime() + 60000);
    const submission: CFSubmission = {
      id: subId++,
      contestId: item.problem.contestId,
      creationTimeSeconds: now.getTime() / 1000,
      problem: { ...item.problem, rating: item.problem.rating! },
      verdict: 'OK',
      programmingLanguage: 'GNU C++20',
      author: { participantType: 'PRACTICE', members: [{ handle: 'battle_tester' }] },
      ...overrides,
    };
    store.ingest('battle_tester', [submission]);
    cmd('sync');
    return item;
  };
  const evaluate = (id: string, result = 'independent') => cmd('evaluate', { itemId: id, result });
  return {
    store,
    service,
    planner,
    start,
    cmd,
    accept,
    evaluate,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}
test('battle selects same skill without submitted, ignored or today tasks and resumes persisted current task', () => {
  const f = fixture();
  try {
    const day = f.store.combinedTrainingDay(new Date('2026-10-23T04:00:00Z'));
    const s = f.start().session!;
    assert(s.items[0].problem.tags.includes('dp'));
    assert(![...day.newProblems, ...day.review].some((p) => p.key === s.items[0].problem.key));
    assert.equal(new BattleService(f.store).state().session!.items[0].id, s.items[0].id);
    assert.throws(() => f.start(), /结束当前连战/);
    const first = s.items[0];
    f.cmd('skip');
    assert.notEqual(f.service.state().session!.items.at(-1)!.problem.key, first.problem.key);
    f.cmd('pause');
    assert.throws(() => f.cmd('skip'), /继续连战/);
    f.accept();
    assert.equal(f.service.state().session!.items.at(-1)!.outcome, 'current');
    f.cmd('resume');
    assert.equal(f.service.state().session!.items.at(-2)!.outcome, 'accepted');
  } finally {
    f.store.close();
  }
});
test('only new personal AC advances; stale revisions and repeated operation IDs never double advance', () => {
  const f = fixture();
  try {
    const s = f.start().session!;
    f.accept({ creationTimeSeconds: Date.parse('2026-10-22T04:00:00Z') / 1000 });
    f.accept({ author: { participantType: 'PRACTICE', teamId: 7, members: [{ handle: 'battle_tester' }] } });
    f.accept({ author: { participantType: 'PRACTICE', members: [{ handle: 'someone_else' }] } });
    f.accept({ verdict: 'WRONG_ANSWER' });
    assert.equal(f.service.state().session!.items.length, 1);
    const before = f.service.state().session!;
    const input = {
      handle: before.handle,
      revision: before.revision,
      operationId: crypto.randomUUID(),
      action: 'skip',
    };
    f.service.command(s.id, input);
    f.service.command(s.id, input);
    assert.equal(f.service.state().session!.items.length, 2);
    assert.throws(
      () => f.service.command(s.id, { ...input, operationId: crypto.randomUUID() }),
      /进度已变化/,
    );
    f.store.activate('another');
    assert.throws(
      () => f.service.command(s.id, { ...input, operationId: crypto.randomUUID() }),
      /账号已变化/,
    );
  } finally {
    f.store.close();
  }
});
test('ordered pending evaluations, multiplier cap, corrections and both mastery computations', () => {
  const f = fixture();
  try {
    f.start();
    const first = f.accept(),
      second = f.accept();
    f.evaluate(second.id);
    assert.equal(allBattleRewards(f.store, 'battle_tester').length, 0);
    f.evaluate(first.id);
    assert.deepEqual(
      allBattleRewards(f.store, 'battle_tester').map((r) => r.multiplier),
      [1.1, 1.2],
    );
    for (let i = 0; i < 4; i++) f.evaluate(f.accept().id);
    const rewards = allBattleRewards(f.store, 'battle_tester');
    assert.deepEqual(
      rewards.map((r) => r.multiplier),
      [1.1, 1.2, 1.3, 1.4, 1.5, 1.5],
    );
    assert.equal(
      f.store.statistics('battle_tester').mastery.find((m) => m.name === '动态规划')!.score,
      Math.round((rewards.reduce((n, r) => n + r.score, 0) + 150) / 9),
    );
    assert.equal(
      f.store.statistics('battle_tester').mastery.find((m) => m.name === '实现与模拟')!.score,
      Math.round((70 * 6 + 150) / 9),
    );
    const tracing = f.planner.tracing();
    let expected = DEFAULT_BKT.initial;
    for (const r of rewards)
      expected = updateKnowledge(expected, true, { ...DEFAULT_BKT, learn: DEFAULT_BKT.learn * r.multiplier });
    assert.equal(tracing.states.find((s) => s.skillId === 'dp')!.probability, expected);
    assert.equal(tracing.states.find((s) => s.skillId === 'dp')!.independentProblems, 6);
    f.evaluate(first.id, 'hint');
    assert.deepEqual(
      allBattleRewards(f.store, 'battle_tester').map((r) => r.multiplier),
      [1, 1.1, 1.2, 1.3, 1.4, 1.5],
    );
    assert.equal(f.planner.tracing().states.find((s) => s.skillId === 'dp')!.independentProblems, 5);
    f.cmd('skip');
    f.evaluate(f.accept().id);
    assert.equal(allBattleRewards(f.store, 'battle_tester').at(-1)!.multiplier, 1.1);
    f.cmd('fail');
    f.evaluate(f.accept().id);
    assert.equal(allBattleRewards(f.store, 'battle_tester').at(-1)!.multiplier, 1.1);
  } finally {
    f.store.close();
  }
});
test('battle deduplicates ordinary evaluations and preserves three distinct problem prerequisite rule', () => {
  const f = fixture();
  try {
    f.start();
    const item = f.accept();
    f.evaluate(item.id);
    const reward = allBattleRewards(f.store, 'battle_tester')[0];
    f.store.put('attempts', 'battle_tester', 'ordinary', {
      id: 'ordinary',
      problemKey: item.problem.key,
      result: 'independent',
      minutes: 20,
      note: '',
      createdAt: reward.evaluatedAt,
    });
    assert.equal(f.planner.observations().filter((o) => o.problemKey === item.problem.key).length, 1);
    const path = buildLearningPath(knowledgeCards, ['dp'], f.planner.tracing().states);
    assert.equal(path.nodes.find((n) => n.id === 'dp')!.verified, false);
    f.evaluate(f.accept().id);
    f.evaluate(f.accept().id);
    assert.equal(
      buildLearningPath(knowledgeCards, ['dp'], f.planner.tracing().states).nodes.find((n) => n.id === 'dp')!
        .verified,
      true,
    );
    f.store.put('attempts', 'battle_tester', 'ordinary', {
      id: 'ordinary',
      problemKey: item.problem.key,
      result: 'hint',
      minutes: 20,
      note: '',
      createdAt: reward.evaluatedAt,
    });
    assert.equal(f.planner.tracing().states.find((s) => s.skillId === 'dp')!.independentProblems, 2);
  } finally {
    f.store.close();
  }
});
test('exhaustion pauses without switching skill; difficulty and explicit resume recover', () => {
  const f = fixture();
  try {
    f.start();
    f.cmd('difficulty', { minimum: 1900, maximum: 2000 });
    f.cmd('skip');
    assert.equal(f.service.state().session!.exhausted, true);
    assert.equal(f.service.state().session!.status, 'paused');
    f.cmd('difficulty', { minimum: 1000, maximum: 1300 });
    f.cmd('resume');
    assert.equal(f.service.state().session!.status, 'active');
    assert.equal(f.service.state().session!.items.at(-1)!.outcome, 'current');
  } finally {
    f.store.close();
  }
});
test('system hint evidence overrides an independent claim, and ignored problems do not unlock learning paths', () => {
  const f = fixture();
  try {
    f.start();
    const item = f.accept();
    f.store.externalPut('learning-source:battle_tester', 'known-hint', {
      id: 'known-hint',
      kind: 'hint',
      problemKey: item.problem.key,
      createdAt: item.issuedAt,
    });
    f.evaluate(item.id);
    assert.equal(f.service.state().session!.items[0].evaluation, 'hint');
    assert.equal(allBattleRewards(f.store, 'battle_tester')[0].multiplier, 1);
    assert.equal(f.planner.tracing().states.find((s) => s.skillId === 'dp')!.independentProblems, 0);
    const second = f.accept();
    f.evaluate(second.id);
    const review = f.store.review('battle_tester', second.problem.key);
    f.store.put('reviews', 'battle_tester', second.problem.key, { ...review, ignored: true });
    assert.equal(f.planner.tracing().states.find((s) => s.skillId === 'dp')!.independentProblems, 0);
  } finally {
    f.store.close();
  }
});
test('an asynchronous sync cannot write into a restored data epoch or advance a paused session', async () => {
  const f = fixture();
  try {
    f.start();
    const before = f.service.state().session!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cf = {
      async call<T>() {
        await gate;
        return [] as T;
      },
    };
    const training = new TrainingService(f.store, cf);
    const pending = f.service.route(
      before.id,
      'POST',
      { handle: before.handle, revision: before.revision, operationId: crypto.randomUUID(), action: 'sync' },
      training,
      cf,
      () => false,
    );
    f.store.restore(f.store.backup());
    release();
    await assert.rejects(pending, /数据已变化/);
    assert.deepEqual(f.service.state().session, before);
    assert.equal(f.store.get('training_meta', 'battle_tester', 'recent'), undefined);
  } finally {
    f.store.close();
  }
});
test('v12 backup restores battle rewards and rejects missing evidence, duplicate active rounds and malformed items atomically', () => {
  const f = fixture();
  const restored = new Store(':memory:');
  try {
    f.start();
    f.evaluate(f.accept().id);
    const backup = f.store.backup();
    assert.equal(backup.version, 12);
    restored.restore(backup);
    assert.deepEqual(allBattleRewards(restored, 'battle_tester'), allBattleRewards(f.store, 'battle_tester'));
    const bad = structuredClone(backup);
    bad.tables.submissions = [];
    assert.throws(() => restored.restore(bad), /AC 证据/);
    assert.equal(new BattleService(restored).state().session!.id, f.service.state().session!.id);
    const double = structuredClone(backup);
    const row = double.external!.find((r) => r.namespace.startsWith('battle:'))!;
    const copy = structuredClone(row);
    copy.key = crypto.randomUUID();
    (copy.value as BattleSession).id = copy.key;
    double.external!.push(copy);
    assert.throws(() => restored.restore(double), /一个进行中/);
    const s = structuredClone(f.service.state().session!);
    s.items.push(structuredClone(s.items[0]));
    assert.throws(() => validateBattle(s, f.store.all('submissions', 'battle_tester')));
    for (let version = 1; version <= 11; version++) {
      const legacy = structuredClone(backup);
      legacy.version = version;
      legacy.external = legacy.external!.filter((r) => !r.namespace.startsWith('battle:'));
      restored.restore(legacy);
      assert.equal(new BattleService(restored).state().session, null);
    }
  } finally {
    f.store.close();
    restored.close();
  }
});
test('sync failures preserve current task, polling shares requests and enforces a 30 second cooldown', async () => {
  const f = fixture();
  try {
    f.start();
    const before = f.service.state().session!;
    let calls = 0;
    const cf = {
      async call<T>() {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return [] as T;
      },
    };
    const training = new TrainingService(f.store, cf);
    await Promise.all([
      training.recent('battle_tester', false, 30000),
      training.recent('battle_tester', false, 30000),
    ]);
    await training.recent('battle_tester', false, 30000);
    assert.equal(calls, 1);
    const broken = {
      async call<T>(): Promise<T> {
        throw new Error('offline');
      },
    };
    f.store.put('training_meta', 'battle_tester', 'recent', { recentCheckedAt: null });
    await assert.rejects(
      f.service.route(
        before.id,
        'POST',
        {
          handle: before.handle,
          revision: before.revision,
          operationId: crypto.randomUUID(),
          action: 'sync',
        },
        new TrainingService(f.store, broken),
        broken,
        () => false,
      ),
      /offline/,
    );
    assert.deepEqual(f.service.state().session, before);
  } finally {
    f.store.close();
  }
});
test('HTTP battle routes persist progress and reject wrong account and version', async () => {
  const f = fixture();
  const { app } = await buildApp(f.store, {
    async call<T>() {
      return [] as T;
    },
  });
  try {
    const res = await app.inject({
      headers: { 'x-review-app': '1' },
      method: 'POST',
      url: '/api/training/battle',
      payload: { handle: 'battle_tester', skillId: 'dp', operationId: crypto.randomUUID() },
    });
    assert.equal(res.statusCode, 200);
    const s = res.json().session as BattleSession;
    const moved = await app.inject({
      headers: { 'x-review-app': '1' },
      method: 'POST',
      url: '/api/training/battle/' + s.id,
      payload: { handle: s.handle, revision: s.revision, operationId: crypto.randomUUID(), action: 'skip' },
    });
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.json().session.items.length, 2);
    const wrong = await app.inject({
      headers: { 'x-review-app': '1' },
      method: 'POST',
      url: '/api/training/battle/' + s.id,
      payload: { handle: 'wrong', revision: s.revision, operationId: crypto.randomUUID(), action: 'skip' },
    });
    assert.equal(wrong.statusCode, 400);
  } finally {
    await app.close();
    f.store.close();
  }
});

test('custom theme battles map tags via the injected mapper and pick only matching catalog problems', async () => {
  const store = new Store(':memory:');
  store.activate('theme_tester');
  let now = new Date('2026-10-23T04:00:00Z');
  store.enrich(
    'theme_tester',
    [],
    [],
    [
      ...Array.from({ length: 5 }, (_, i) => ({
        contestId: 7500 + i,
        index: 'A',
        name: 'Seg ' + i,
        rating: 1200,
        tags: ['segment tree'],
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        contestId: 7600 + i,
        index: 'A',
        name: 'DP ' + i,
        rating: 1200,
        tags: ['dp'],
      })),
    ],
  );
  const service = new BattleService(store, () => now, {
    themeMapper: async (theme) => {
      assert.equal(theme, '线段树');
      return { tags: ['segment tree'], skillId: 'segment-tree' };
    },
  });
  try {
    const state = await service.startWithTheme({
      handle: 'theme_tester',
      theme: '线段树',
      operationId: crypto.randomUUID(),
    });
    const s = state.session!;
    assert.equal(s.custom?.theme, '线段树');
    assert.deepEqual(s.custom?.tags, ['segment tree']);
    assert.equal(s.skillId, 'segment-tree');
    assert.ok(s.items[0].problem.name.startsWith('Seg'), '应从 segment tree 标签中选题');
    assert.ok(s.items[0].problem.tags.includes('segment tree'));
    // 战报行：主题、耗时、题数
    const row = state.history.at(-1)!;
    assert.equal(row.theme, '线段树');
    assert.equal(row.problemCount, 1);
    assert.ok(Number.isFinite(row.durationMinutes));
    // 备份往返保留 custom
    const backup = store.backup();
    store.restore(backup);
    assert.equal(store.externalGet<BattleSession>('battle:theme_tester', s.id)?.custom?.theme, '线段树');
    store.close();
  } catch (e) {
    store.close();
    throw e;
  }
});

test('battle records expose theme, duration and counts, and summaries persist through backup', async () => {
  const store = new Store(':memory:');
  store.activate('record_tester');
  let now = new Date('2026-10-23T04:00:00Z');
  store.enrich(
    'record_tester',
    [],
    [],
    Array.from({ length: 6 }, (_, i) => ({
      contestId: 7700 + i,
      index: 'A',
      name: 'R ' + i,
      rating: 1100,
      tags: ['dp'],
    })),
  );
  const aiSummary = {
    text: '本轮完成了 1 道动态规划题，节奏稳定。',
    highlights: ['首题独立完成'],
    advice: ['继续巩固状态设计'],
  };
  const service = new BattleService(store, () => now, { summarizer: async () => aiSummary });
  const start = () =>
    service.start({ handle: 'record_tester', skillId: 'dp', operationId: crypto.randomUUID() });
  const cmd = (action: string, extra: Record<string, unknown> = {}) => {
    const s = service.state().session!;
    return service.command(s.id, {
      handle: 'record_tester',
      revision: s.revision,
      operationId: crypto.randomUUID(),
      action,
      ...extra,
    });
  };
  try {
    start();
    now = new Date(now.getTime() + 60000);
    const item = service.state().session!.items.find((i) => i.outcome === 'current')!;
    store.ingest('record_tester', [
      {
        id: 900,
        contestId: item.problem.contestId,
        creationTimeSeconds: now.getTime() / 1000,
        problem: { ...item.problem, rating: item.problem.rating! },
        verdict: 'OK',
        programmingLanguage: 'GNU C++20',
        author: { participantType: 'PRACTICE', members: [{ handle: 'record_tester' }] },
      },
    ]);
    cmd('sync');
    cmd('evaluate', { itemId: item.id, result: 'independent' });
    now = new Date(now.getTime() + 300000);
    cmd('end');
    const records = service.records();
    assert.equal(records.length, 1);
    const row = records[0];
    assert.equal(row.theme, '动态规划');
    assert.equal(row.status, 'ended');
    // AC 后自动出了下一题：发出 2 题（含未开做的当前题），通过 1 题
    assert.equal(row.problemCount, 2);
    assert.equal(row.solvedCount, 1);
    assert.ok(row.durationMinutes >= 5);
    assert.ok(!row.summary);
    // 生成总结 → 持久化 → records 带 summary → 重新生成覆盖
    const { summary } = await service.summarize(row.id, {
      handle: 'record_tester',
      operationId: crypto.randomUUID(),
    });
    assert.equal(summary.text, aiSummary.text);
    assert.equal(savedSummary(store, 'record_tester', row.id)?.text, aiSummary.text);
    assert.equal(service.records()[0].summary?.text, aiSummary.text);
    // battleFacts 供 AI 使用
    const session = store.externalGet<BattleSession>('battle:record_tester', row.id)!;
    const facts = battleFacts(store, session);
    assert.equal(facts.theme, '动态规划');
    assert.equal(facts.accepted, 1);
    assert.equal(facts.problemCount, 2);
    assert.equal(facts.bestStreak, 1);
    // 恢复备份时连战总结一起回来
    const backup = store.backup();
    store.restore(backup);
    assert.equal(savedSummary(store, 'record_tester', row.id)?.text, aiSummary.text);
    store.close();
  } catch (e) {
    store.close();
    throw e;
  }
});

test('theme mapping: local dictionary, AI fallback with vocabulary clamp and readable failures', async () => {
  const local = themeMapping('线段树进阶');
  assert.deepEqual(local?.tags, ['segment tree']);
  assert.equal(local?.skillId, 'segment-tree');
  assert.equal(themeMapping('不存在的东西 xyzzy')?.tags, undefined);
  const store = new Store(':memory:');
  store.activate('mapper_tester');
  store.externalPut('ai', 'config', { baseUrl: 'https://fixture.invalid/v1', apiKey: 'k', model: 'm' });
  try {
    // 未配置 AI 且词典未命中 → 可读错误（这里传入 null completer 模拟未配置）
    await assert.rejects(
      () => mapTheme(store, null, '完全陌生的主题'),
      /无法识别该主题/,
    );
    // AI 兜底：返回词表外的标签会被裁剪，非法 skillId 回落到最近知识卡
    const fakeAi = {
      complete: async () => JSON.stringify({ tags: ['segment tree', 'nonexistent-tag'], skillId: 'nope' }),
    };
    const mapped = await mapTheme(store, fakeAi, '完全陌生的主题');
    assert.deepEqual(mapped.tags, ['segment tree']);
    assert.ok(knowledgeCards.some((c) => c.id === mapped.skillId));
    // parseThemeAi 空标签直接被 schema 拒绝
    assert.throws(() => parseThemeAi('{"tags":[],"skillId":"dp"}'));
    store.close();
  } catch (e) {
    store.close();
    throw e;
  }
});

test('insights and monthly report include battle records with theme, duration and counts', () => {
  const store = new Store(':memory:');
  store.activate('report_tester');
  let now = new Date('2026-10-23T04:00:00Z');
  store.enrich(
    'report_tester',
    [],
    [],
    Array.from({ length: 6 }, (_, i) => ({
      contestId: 7800 + i,
      index: 'A',
      name: 'M ' + i,
      rating: 1100,
      tags: ['dp'],
    })),
  );
  const service = new BattleService(store, () => now);
  const start = () =>
    service.start({ handle: 'report_tester', skillId: 'dp', operationId: crypto.randomUUID() });
  const cmd = (action: string, extra: Record<string, unknown> = {}) => {
    const s = service.state().session!;
    return service.command(s.id, {
      handle: 'report_tester',
      revision: s.revision,
      operationId: crypto.randomUUID(),
      action,
      ...extra,
    });
  };
  try {
    start();
    now = new Date(now.getTime() + 60000);
    const item = service.state().session!.items.find((i) => i.outcome === 'current')!;
    store.ingest('report_tester', [
      {
        id: 901,
        contestId: item.problem.contestId,
        creationTimeSeconds: now.getTime() / 1000,
        problem: { ...item.problem, rating: item.problem.rating! },
        verdict: 'OK',
        programmingLanguage: 'GNU C++20',
        author: { participantType: 'PRACTICE', members: [{ handle: 'report_tester' }] },
      },
    ]);
    cmd('sync');
    now = new Date(now.getTime() + 120000);
    cmd('end');
    const insights = buildInsights(store, now);
    assert.equal(insights.battles.total, 1);
    assert.equal(insights.battles.totalProblems, 2);
    assert.equal(insights.battles.solvedProblems, 1);
    assert.equal(insights.battles.recent[0].theme, '动态规划');
    assert.equal(insights.battles.recent[0].summaryText, null);
    const report = monthlyReport(store, { month: '2026-10' }, now);
    assert.equal(report.battles.length, 1);
    assert.equal(report.battles[0].theme, '动态规划');
    assert.equal(report.battles[0].problemCount, 2);
    assert.equal(report.battles[0].solvedCount, 1);
    assert.ok(report.battles[0].durationMinutes >= 0);
    store.close();
  } catch (e) {
    store.close();
    throw e;
  }
});
