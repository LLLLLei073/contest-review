import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { monthlyReport, beijingDay } from '../shared/monthly-report.js';
import { LearningService } from '../shared/learning-service.js';
import { AiReviewer, type FetchLike } from '../shared/ai-review.js';
import type { CFSubmission } from '../shared/domain.js';
import type { LearningRecord } from '../shared/learning-domain.js';
import { learningNamespace } from '../shared/learning-domain.js';
import type { AtcoderHistory } from '../shared/atcoder.js';

const oct = new Date('2026-11-05T12:00:00+08:00');
function sub(
  id: number,
  index: string,
  at: string,
  verdict = 'OK',
  type = 'PRACTICE',
  contestId = 2000,
): CFSubmission {
  return {
    id,
    contestId,
    creationTimeSeconds: Date.parse(at) / 1000,
    problem: { contestId, index, name: '题目 ' + index, tags: ['dp'] },
    verdict,
    programmingLanguage: 'C++',
    author: {
      participantType: type,
      ...(type === 'VIRTUAL' ? { startTimeSeconds: Date.parse(at) / 1000 } : {}),
    },
  };
}
function setup() {
  const s = new Store(':memory:');
  s.activate('monthly');
  return s;
}
const query = { month: '2026-10' };

test('Beijing month boundaries, full submissions including AC-only problems, duplicates and first AC', () => {
  const s = setup();
  s.ingest('monthly', [
    sub(1, 'A', '2026-09-30T15:59:59Z'),
    sub(2, 'A', '2026-09-30T16:00:00Z'),
    sub(3, 'B', '2026-10-31T15:59:59Z'),
    sub(4, 'C', '2026-10-31T16:00:00Z'),
    sub(5, 'D', '2026-10-03T00:00:00Z', 'WRONG_ANSWER'),
  ]);
  s.ingest('monthly', [sub(3, 'B', '2026-10-31T15:59:59Z')]);
  const before = s.backup(),
    r = monthlyReport(s, query, oct);
  assert.equal(beijingDay(new Date('2026-09-30T16:00:00Z')), '2026-10-01');
  assert.equal(r.metrics.attempted, 3);
  assert.equal(r.metrics.accepted, 2);
  assert.equal(r.metrics.firstAccepted, 1);
  assert.equal(r.metrics.submissions, 3);
  assert.equal(r.days.length, 31);
  assert.equal(r.days[0].submissions, 1);
  assert.equal(r.days[30].submissions, 1);
  assert.equal(r.firstAcceptedLabel, '已导入记录中的首次通过');
  assert.deepEqual({ ...s.backup(), exportedAt: '' }, { ...before, exportedAt: '' });
  s.close();
});
test('platform separation, pending and system verdicts do not become failures', () => {
  const s = setup();
  s.activateAtcoder('monthly_ac');
  s.ingest('monthly', [
    sub(1, 'A', '2026-10-02T00:00:00Z'),
    sub(2, 'B', '2026-10-02T00:00:00Z', 'TESTING'),
    sub(3, 'C', '2026-10-02T00:00:00Z', 'SKIPPED'),
    sub(4, 'D', '2026-10-02T00:00:00Z', 'WRONG_ANSWER'),
  ]);
  s.ingestAtcoder('ac~monthly_ac', [
    {
      id: 1,
      epoch_second: Date.parse('2026-10-02T00:00:00Z') / 1000,
      problem_id: 'abc001_a',
      contest_id: 'abc001',
      user_id: 'monthly_ac',
      language: 'Python',
      result: 'WJ',
    },
  ]);
  const all = monthlyReport(s, query, oct);
  assert.equal(all.metrics.submissions, 5);
  assert.equal(all.metrics.attempted, 5);
  assert.equal(all.metrics.pending, 2);
  assert.equal(all.metrics.other, 1);
  assert.equal(all.metrics.failed, 1);
  assert.equal(monthlyReport(s, { ...query, source: 'cf' }, oct).metrics.submissions, 4);
  assert.equal(monthlyReport(s, { ...query, source: 'atcoder' }, oct).metrics.submissions, 1);
  s.close();
});
test('current month comparison uses previous elapsed period, zero and absent baselines omit percentages', () => {
  const s = setup();
  s.ingest('monthly', [
    sub(1, 'A', '2026-09-03T00:00:00+08:00'),
    sub(2, 'B', '2026-09-25T00:00:00+08:00'),
    sub(3, 'C', '2026-10-03T00:00:00+08:00'),
    sub(4, 'D', '2026-10-20T00:00:00+08:00'),
  ]);
  const r = monthlyReport(s, query, new Date('2026-10-15T12:00:00+08:00'));
  assert.equal(r.metrics.submissions, 1);
  assert.equal(r.comparison.metrics.submissions, 1);
  assert.equal(r.comparison.endAt, '2026-09-15T04:00:00.000Z');
  assert.equal(r.comparison.changes.submissions?.percent, 0);
  assert.equal(r.comparison.changes.contests?.percent, null);
  assert.equal(monthlyReport(s, { month: '2026-08' }, oct).comparison.changes.submissions, null);
  assert.throws(() => monthlyReport(s, { month: '2026-12' }, oct), /历史月份/);
  assert.throws(() => monthlyReport(s, { month: '2026-13' }, oct));
  s.close();
});
test('short previous month is capped, leap February is complete, full-history label and empty data', () => {
  const s = setup();
  s.put('jobs', 'monthly', 'full', {
    id: 'full',
    handle: 'monthly',
    mode: 'full',
    status: 'completed',
    processed: 0,
    cursor: 1,
    message: '',
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-02T00:00:00Z',
  });
  assert.equal(monthlyReport(s, query, oct).firstAcceptedLabel, '历史首次通过');
  const r = monthlyReport(s, { month: '2026-03' }, new Date('2026-03-31T12:00:00+08:00'));
  assert.equal(r.comparison.endAt, '2026-02-28T16:00:00.000Z');
  assert.equal(monthlyReport(s, { month: '2024-02' }, oct).days.length, 29);
  assert.equal(r.metrics.submissions, 0);
  assert.ok(r.warnings.some((w) => w.includes('不足')));
  s.close();
});
test('official, virtual, practice, AtCoder window and XCPC team counts and missing-start exclusions', () => {
  const s = setup();
  s.activateAtcoder('monthly_ac');
  s.ingest('monthly', [
    sub(1, 'A', '2026-10-03T00:00:00Z', 'OK', 'CONTESTANT', 2000),
    sub(2, 'A', '2026-10-03T00:00:00Z', 'OK', 'VIRTUAL', 2001),
    sub(3, 'A', '2026-10-03T00:00:00Z', 'OK', 'PRACTICE', 2002),
    sub(4, 'A', '2026-10-03T00:00:00Z', 'OK', 'CONTESTANT', 2003),
  ]);
  for (const id of [2000, 2001, 2002])
    s.put('contests', 'monthly', String(id), {
      id,
      name: 'Round ' + id,
      startTimeSeconds: Date.parse('2026-10-03T00:00:00Z') / 1000,
      durationSeconds: 7200,
    });
  s.externalPut('atcoder-meta', 'catalog', {
    contests: ['abc001', 'abc002', 'abc003'].map((id) => ({
      id,
      title: id,
      start_epoch_second: Date.parse('2026-10-03T00:00:00Z') / 1000,
      duration_second: 7200,
    })),
    problems: [],
    models: {},
  });
  s.externalPut('atcoder:monthly_ac', 'history', {
    fetchedAt: '2026-11-01T00:00:00Z',
    source: 'atcoder-official-via-proxy',
    entries: ['abc001', 'abc004'].map((id) => ({
      ContestScreenName: id + '.contest.atcoder.jp',
      ContestName: id,
      IsRated: true,
      Place: 10,
      OldRating: 800,
      NewRating: 900,
      Performance: 1200,
      EndTime: '2026-10-03T02:00:00Z',
    })),
  });
  s.ingestAtcoder(
    'ac~monthly_ac',
    ['abc001', 'abc002', 'abc003'].map((id, i) => ({
      id: i + 1,
      epoch_second: Date.parse(i === 2 ? '2026-10-04T00:00:00Z' : '2026-10-03T01:00:00Z') / 1000,
      problem_id: id + '_a',
      contest_id: id,
      user_id: 'monthly_ac',
      result: 'AC',
      language: 'Python',
    })),
  );
  s.setSetting('xcpc-active', 'player');
  s.externalPut('xcpc:player', 'history:regional', {
    contestId: 'regional',
    title: 'Regional',
    startAt: '2026-10-12T00:00:00Z',
    teamName: 'Team',
    rank: 10,
    teamCount: 100,
    official: true,
    rated: true,
    ratedOfficial: true,
    solved: 5,
  });
  const r = monthlyReport(s, query, oct);
  assert.equal(r.metrics.contests, 4);
  assert.equal(r.metrics.official, 3);
  assert.equal(r.metrics.virtual, 1);
  assert.equal(r.metrics.window, 1);
  assert.equal(r.contests.length, 5);
  assert.equal(r.contests.find((c) => c.source === 'xcpc')?.teamName, 'Team');
  assert.equal(r.contests.find((c) => c.key === 'atcoder:abc001')?.rating?.new, 900);
  assert.ok(r.warnings.some((w) => w.includes('abc004') && w.includes('开始时间')));
  assert.ok(r.warnings.some((w) => w.includes('2003') && w.includes('开始时间')));
  assert.equal(monthlyReport(s, { ...query, source: 'atcoder' }, oct).metrics.contests, 1);
  const history = s.externalGet<AtcoderHistory>('atcoder:monthly_ac', 'history')!;
  history.entries[0].OldRating = -1;
  history.entries[0].NewRating = -1;
  history.entries[0].Performance = 0;
  s.externalPut('atcoder:monthly_ac', 'history', history);
  const rating = monthlyReport(s, query, oct).contests.find((c) => c.key === 'atcoder:abc001')!.rating;
  assert.equal(rating?.old, null);
  assert.equal(rating?.new, null);
  assert.equal(rating?.performance, null);
  s.close();
});
test('hints count sessions, transfer uses evaluation time, redo and combined plans do not double count', () => {
  const s = setup();
  s.activateAtcoder('monthly_ac');
  s.ingest('monthly', [sub(1, 'A', '2026-10-03T00:00:00Z', 'WRONG_ANSWER')]);
  s.put('attempts', 'monthly', 'redo', {
    id: 'redo',
    problemKey: '2000:A',
    result: 'hint',
    minutes: 12,
    note: '',
    createdAt: '2026-10-03T00:00:00Z',
  });
  const plan = {
    date: '2026-10-03',
    review: [{ key: '2000:A', kind: 'due', completedAt: '2026-10-03T00:00:00Z' }],
    newKeys: [],
    catalogReady: false,
    createdAt: '2026-10-03T00:00:00Z',
  };
  s.put('daily_plans', 'monthly', plan.date, plan);
  s.externalPut('daily:monthly:monthly_ac', plan.date, plan);
  for (const level of [1, 2, 3])
    s.externalPut('learning-source:monthly', 'hint' + level, {
      kind: 'hint',
      id: 'hint' + level,
      problemKey: '2000:A',
      session: 'session',
      level,
      content: 'hint',
      createdAt: '2026-10-03T00:00:00Z',
    } as LearningRecord);
  const ns = learningNamespace('monthly', 'monthly_ac');
  s.externalPut(ns, 'transfer', {
    kind: 'transfer',
    id: 'transfer',
    problemKey: '2000:B',
    targetKey: '2000:A',
    knowledgeIds: ['dp'],
    date: '2026-09-30',
    reason: '',
    result: 'hint',
    createdAt: '2026-09-30T00:00:00Z',
    evaluatedAt: '2026-10-03T00:00:00Z',
    minutes: 12,
  });
  const r = monthlyReport(s, query, oct);
  assert.equal(r.metrics.hintSessions, 1);
  assert.equal(r.metrics.hint, 1);
  assert.equal(r.metrics.transferHint, 1);
  assert.equal(r.metrics.reviewAssigned, 1);
  assert.equal(r.metrics.reviewCompleted, 1);
  assert.equal(monthlyReport(s, { ...query, source: 'atcoder' }, oct).metrics.transferHint, 0);
  assert.ok(r.evidence.some((e) => e.text.includes('手工用时 12')));
  s.close();
});
test('monthly reason snapshots use latest per problem, no invented historical reasons', () => {
  const s = setup();
  const key = s.manualProblem('monthly', {
    contestId: 2000,
    index: 'A',
    name: 'manual',
    rating: 1000,
    tags: ['dp'],
  });
  s.externalPut('reason:monthly', 'old', {
    id: 'old',
    problemKey: key,
    savedAt: '2026-10-01T00:00:00Z',
    reasons: ['实现错误'],
  });
  s.externalPut('reason:monthly', 'new', {
    id: 'new',
    problemKey: key,
    savedAt: '2026-10-02T00:00:00Z',
    reasons: ['边界遗漏'],
  });
  s.externalPut('reason:monthly', 'outside', {
    id: 'outside',
    problemKey: key,
    savedAt: '2026-11-01T00:00:00Z',
    reasons: ['算法不熟'],
  });
  const r = monthlyReport(s, query, oct);
  assert.ok(r.findings.some((f) => f.title.includes('边界遗漏')));
  assert.ok(!r.findings.some((f) => f.title.includes('实现错误') || f.title.includes('算法不熟')));
  const ids = new Set(r.evidence.map((e) => e.id));
  assert.ok(r.findings.every((f) => f.evidenceIds.every((id) => ids.has(id))));
  s.close();
});
function aiSetup(response: () => unknown | Promise<unknown>) {
  const s = setup();
  s.externalPut('ai', 'config', { baseUrl: 'https://model.invalid/v1', model: 'test', apiKey: 'test' });
  const fetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(await response()) } }] }),
  });
  return { s, l: new LearningService(s, new AiReviewer(fetch)), fetch };
}
const good = () => ({
  findings: [
    { title: '月度建议', cause: '提交样本有限', action: '继续训练', evidenceIds: ['monthly:volume'] },
  ],
  warnings: [],
});
test('monthly AI validates evidence, format, stale input and does not persist results', async () => {
  const { s, l } = aiSetup(good),
    r = monthlyReport(s);
  const before = s.backup();
  await l.monthly({ month: r.month, fingerprint: r.fingerprint });
  assert.deepEqual({ ...s.backup(), exportedAt: '' }, { ...before, exportedAt: '' });
  await assert.rejects(l.monthly({ fingerprint: 'stale' }), /数据已变化/);
  const invalid = aiSetup(() => ({
    findings: [{ ...good().findings[0], evidenceIds: ['invented'] }],
    warnings: [],
  }));
  await assert.rejects(invalid.l.monthly({ fingerprint: monthlyReport(invalid.s).fingerprint }), /不存在/);
  const bad = aiSetup(() => ({ text: 'invalid' }));
  await assert.rejects(bad.l.monthly({ fingerprint: monthlyReport(bad.s).fingerprint }));
  s.close();
  invalid.s.close();
  bad.s.close();
});
test('monthly AI cancels on account switches, restore and changed report evidence', async () => {
  for (const change of ['account', 'restore', 'data']) {
    let release!: () => void, started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { s, l } = aiSetup(async () => {
      started();
      await gate;
      return good();
    });
    const r = monthlyReport(s),
      promise = l.monthly({ fingerprint: r.fingerprint });
    await ready;
    if (change === 'account') {
      s.activate('other');
      s.activate('monthly');
    }
    if (change === 'restore') s.restore(s.backup());
    if (change === 'data') s.ingest('monthly', [sub(1, 'A', new Date(Date.now() - 1000).toISOString())]);
    release();
    await assert.rejects(promise, /已变化|已取消/);
    s.close();
  }
});
test('monthly API validation, fixed-model response and offline statistics', async () => {
  const { s, fetch } = aiSetup(good),
    { app } = await buildApp(s, undefined, { aiFetch: fetch });
  const get = await app.inject('/api/statistics/monthly');
  assert.equal(get.statusCode, 200);
  const r = get.json();
  assert.equal((await app.inject('/api/statistics/monthly?month=bad')).statusCode, 400);
  const post = await app.inject({
    method: 'POST',
    url: '/api/learning/monthly-report',
    headers: { 'x-review-app': '1' },
    payload: { month: r.month, fingerprint: r.fingerprint },
  });
  assert.equal(post.statusCode, 200);
  assert.equal(post.json().findings[0].title, '月度建议');
  s.externalDelete('ai', 'config');
  assert.equal((await app.inject('/api/statistics/monthly')).statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/learning/monthly-report',
        headers: { 'x-review-app': '1' },
        payload: { fingerprint: monthlyReport(s).fingerprint },
      })
    ).statusCode,
    400,
  );
  await app.close();
  s.close();
});

test('virtual session start determines month; repeated manual sessions and official records count once', () => {
  const s = setup();
  s.ingest('monthly', [sub(1, 'A', '2026-10-04T00:00:00Z', 'OK', 'VIRTUAL', 2000)]);
  s.put('contests', 'monthly', '2000', {
    id: 2000,
    name: 'Old Round',
    startTimeSeconds: Date.parse('2026-09-01T00:00:00Z') / 1000,
    durationSeconds: 7200,
  });
  for (const id of ['one', 'two'])
    s.externalPut('simulation:monthly', id, {
      id,
      contestId: 2000,
      contestName: 'Old Round',
      startedAt: '2026-10-04T00:00:00Z',
      durationSeconds: 7200,
      finishedAt: '2026-10-04T02:00:00Z',
      manual: [],
    });
  assert.equal(monthlyReport(s, query, oct).metrics.virtual, 1);
  s.ingest('monthly', [sub(2, 'B', '2026-09-01T00:00:00Z', 'OK', 'CONTESTANT', 2000)]);
  assert.equal(monthlyReport(s, query, oct).metrics.virtual, 0);
  assert.equal(monthlyReport(s, { month: '2026-09' }, oct).metrics.official, 1);
  s.close();
});
test('monthly AI timeout and network failure preserve offline rule report', async () => {
  const s = setup();
  s.externalPut('ai', 'config', { baseUrl: 'https://model.invalid/v1', model: 'test', apiKey: 'test' });
  for (const message of ['timeout', 'network unavailable']) {
    const l = new LearningService(
      s,
      new AiReviewer(async () => {
        throw new Error(message);
      }),
    );
    const r = monthlyReport(s);
    await assert.rejects(l.monthly({ fingerprint: r.fingerprint }));
    assert.equal(monthlyReport(s).fingerprint, r.fingerprint);
    assert.ok(monthlyReport(s).findings.length > 0);
  }
  s.close();
});
