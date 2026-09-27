import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import {
  AtcoderService,
  atcoderProfile,
  atcoderNamespace,
  type AtcoderClientLike,
  type AtcoderSubmission,
} from '../shared/atcoder.js';
import { emptyReview } from '../shared/domain.js';
import { localDay } from '../shared/core-store.js';
import { buildApp } from '../server/app.js';

const midday = new Date();
midday.setHours(12, 0, 0, 0);
const sec = Math.floor(midday.getTime() / 1000);
const submission = (id: number, problem: string, result: string, time = sec): AtcoderSubmission => ({
  id,
  epoch_second: time,
  problem_id: problem,
  contest_id: 'abc001',
  user_id: 'Alice',
  language: 'C++',
  result,
});
class FakeAtcoder implements AtcoderClientLike {
  items: AtcoderSubmission[] = [];
  calls: number[] = [];
  failAt = 0;
  cancel() {}
  async submissions(_handle: string, from: number) {
    this.calls.push(from);
    if (this.failAt && from >= this.failAt) throw new Error('fixture outage');
    return this.items
      .filter((s) => s.epoch_second >= from)
      .sort((a, b) => a.epoch_second - b.epoch_second || a.id - b.id)
      .slice(0, 500);
  }
  async resources<T>(name: 'problems' | 'contests' | 'problem-models'): Promise<T> {
    if (name === 'problems')
      return [
        { id: 'abc001_1', contest_id: 'abc001', problem_index: 'A', name: 'Practice A' },
        { id: 'abc001_2', contest_id: 'abc001', problem_index: 'B', name: 'Practice B' },
      ] as T;
    if (name === 'contests')
      return [
        { id: 'abc001', start_epoch_second: sec - 3600, duration_second: 7200, title: 'ABC Fixture' },
      ] as T;
    return { abc001_1: { difficulty: 800 }, abc001_2: { difficulty: 1200 } } as T;
  }
}
function setup() {
  const store = new Store(':memory:');
  store.activate('cfuser');
  store.activateAtcoder('Alice');
  const client = new FakeAtcoder();
  const service = new AtcoderService(store, client);
  return { store, client, service };
}

test('AtCoder pagination, repeat import, rejudge, account isolation and backup v5', async () => {
  const { store, client, service } = setup();
  client.items = Array.from({ length: 501 }, (_, i) =>
    submission(i + 1, 'abc001_1', i === 0 ? 'WA' : 'AC', sec - 500 + i),
  );
  service.start('Alice', 'full');
  await service.running;
  const profile = atcoderProfile('Alice');
  assert.equal(store.all('submissions', profile).length, 501);
  assert.equal(store.problems(profile).length, 1);
  assert.ok(client.calls.length >= 2);
  const review = { ...emptyReview(), rootCause: '边界漏判', categories: ['数学' as const] };
  store.saveReview(profile, 'atcoder:abc001_1', review);
  client.items[0] = { ...client.items[0], result: 'AC' };
  service.start('Alice', 'full');
  await service.running;
  assert.equal(store.all('submissions', profile).length, 501);
  assert.equal(store.review(profile, 'atcoder:abc001_1').rootCause, '边界漏判');
  const backup = store.backup();
  assert.equal(backup.version, 5);
  store.activateAtcoder('Bob');
  assert.equal(store.problems(atcoderProfile('Bob')).length, 0);
  store.restore(backup);
  assert.equal(store.activeAtcoder(), 'Alice');
  assert.equal(store.review(profile, 'atcoder:abc001_1').categories[0], '数学');
  store.externalPut(atcoderNamespace('Alice'), 'review:abc001', {
    timeAllocation: '5 分钟',
    mistakes: '',
    improvements: '',
  });
  store.activateAtcoder('alice');
  assert.equal(
    store.externalGet<{ timeAllocation: string }>(atcoderNamespace(store.activeAtcoder()), 'review:abc001')
      ?.timeAllocation,
    '5 分钟',
  );
  assert.equal(store.problems('cfuser').length, 0);
  store.close();
});

test('AtCoder same-day AC confirms redo, cross-platform review stays fixed and untagged radar is empty', () => {
  const { store } = setup(),
    profile = atcoderProfile('Alice');
  store.ingestAtcoder(profile, [submission(1, 'abc001_1', 'WA')]);
  store.ingest('cfuser', [
    {
      id: 88,
      contestId: 2000,
      creationTimeSeconds: sec,
      problem: { contestId: 2000, index: 'A', name: 'CF A', tags: ['math'] },
      verdict: 'WRONG_ANSWER',
      programmingLanguage: 'C++',
      author: { participantType: 'PRACTICE' },
    },
  ]);
  const first = store.combinedTrainingDay(midday);
  assert.equal(first.review.length, 2);
  assert.equal(new Set(first.review.map((r) => r.key)).size, 2);
  assert.equal(
    store.combinedStatistics('atcoder', midday).mastery.find((a) => a.name === '实现与模拟')?.samples,
    0,
  );
  store.ingestAtcoder(profile, [submission(2, 'abc001_1', 'AC')]);
  const day = store.combinedTrainingDay(midday);
  assert.deepEqual(
    day.review.map((r) => r.key),
    first.review.map((r) => r.key),
  );
  assert.equal(day.review.find((r) => r.source === 'atcoder')?.phase, 'reflection');
  assert.equal(store.review(profile, 'atcoder:abc001_1').stage, 0);
  assert.equal(store.review(profile, 'atcoder:abc001_1').nextReview, null);
  assert.equal(localDay(new Date(store.review(profile, 'atcoder:abc001_1').firstRedoAt!)), localDay(midday));
  store.ingestAtcoder(profile, [submission(2, 'abc001_1', 'WA')]);
  assert.equal(
    store.combinedTrainingDay(midday).review.find((r) => r.source === 'atcoder')?.redoAccepted,
    false,
  );
  store.close();
});

test('AtCoder report separates contest-window and after-contest submissions without invented score', async () => {
  const { store, client, service } = setup();
  client.items = [
    submission(1, 'abc001_1', 'WA', sec - 1800),
    submission(2, 'abc001_1', 'AC', sec - 1200),
    submission(3, 'abc001_2', 'AC', sec + 10000),
  ];
  service.start('Alice', 'full');
  await service.running;
  const report = service.report('abc001');
  assert.equal(report.solved, 1);
  assert.equal(report.failures, 1);
  assert.equal(report.inContest.length, 2);
  assert.equal(report.afterContest.length, 1);
  assert.equal(service.contests()[0].inContestSolved, 1);
  assert.equal(service.contests()[0].analysisScore, null);
  store.close();
});

test('AtCoder interrupted paging preserves records and resumes; empty account remains unverified', async () => {
  const { store, client, service } = setup();
  client.items = Array.from({ length: 502 }, (_, i) => submission(i + 1, 'abc001_1', 'WA', sec - 502 + i));
  client.failAt = sec - 3;
  service.start('Alice', 'full');
  await service.running;
  assert.equal(store.latestJob(atcoderProfile('Alice'))?.status, 'failed');
  assert.equal(store.all('submissions', atcoderProfile('Alice')).length, 500);
  client.failAt = 0;
  service.start('Alice', 'full', true);
  await service.running;
  assert.equal(store.all('submissions', atcoderProfile('Alice')).length, 502);
  store.activateAtcoder('Empty');
  client.items = [];
  service.start('Empty', 'full');
  await service.running;
  assert.equal(store.all('submissions', atcoderProfile('Empty')).length, 0);
  store.close();
});

test('binding CF after an AtCoder-only day does not refill either lane', () => {
  const store = new Store(':memory:');
  store.activateAtcoder('Alice');
  const profile = atcoderProfile('Alice');
  store.ingestAtcoder(profile, [submission(1, 'abc001_1', 'WA')]);
  const first = store.combinedTrainingDay(midday);
  assert.equal(first.review.length, 1);
  assert.equal(first.newProblems.length, 0);
  store.activate('cfuser');
  store.enrich(
    'cfuser',
    [],
    [],
    [{ contestId: 2001, index: 'A', name: 'New CF', rating: 800, tags: ['math'] }],
  );
  const sameDay = store.combinedTrainingDay(midday);
  assert.deepEqual(
    sameDay.review.map((p) => p.key),
    first.review.map((p) => p.key),
  );
  assert.equal(sameDay.newProblems.length, 0);
  store.close();
});

test('failed report refresh retains the previously cached report', async () => {
  const { store, client, service } = setup();
  client.items = [submission(1, 'abc001_1', 'AC', sec)];
  service.start('Alice', 'full');
  await service.running;
  const old = service.report('abc001');
  client.failAt = 1;
  await assert.rejects(service.refresh('abc001'));
  assert.deepEqual(service.report('abc001'), old);
  store.close();
});

test('local API binds AtCoder without CF and exposes merged notebook, day and report', async () => {
  const store = new Store(':memory:'),
    client = new FakeAtcoder();
  client.items = [submission(1, 'abc001_1', 'WA', sec - 100)];
  const { app, atcoder, hub } = await buildApp(store, undefined, { atcoder: client });
  const headers = { host: '127.0.0.1:3211', 'x-review-app': '1', origin: 'http://127.0.0.1:3211' };
  const request = async (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    (await app.inject({ method, url, headers, payload: payload as any })) as unknown as {
      statusCode: number;
      json: () => any;
    };
  assert.equal((await request('POST', '/api/atcoder/binding', { handle: 'Alice' })).statusCode, 200);
  assert.equal((await request('POST', '/api/atcoder/sync', { mode: 'full' })).statusCode, 200);
  await atcoder.running;
  const problems = await request('GET', '/api/problems');
  assert.equal(problems.json().total, 1);
  const day = await request('GET', '/api/training/day');
  assert.equal(day.json().review.length, 1);
  assert.equal(day.json().newProblems.length, 0);
  const stats = await request('GET', '/api/statistics?source=atcoder');
  assert.equal(stats.json().total, 1);
  const contests = await request('GET', '/api/review/contests');
  assert.equal(contests.json()[0].source, 'atcoder');
  const batch = await request('POST', '/api/review/batch', {});
  assert.equal(batch.statusCode, 200);
  await hub.running;
  assert.equal(hub.latestJob()?.status, 'completed');
  const report = await request('GET', '/api/atcoder/contests/abc001/analysis');
  assert.equal(report.json().solved, 0);
  await app.close();
  store.close();
});

test('v4 backup remains restorable and corrupt v5 AtCoder data cannot replace current records', () => {
  const store = new Store(':memory:');
  store.activate('cfuser');
  store.manualProblem('cfuser', { contestId: 2000, index: 'A', name: 'CF note', rating: null, tags: [] });
  const v4 = structuredClone(store.backup()) as Record<string, any>;
  v4.version = 4;
  delete v4.activeAtcoder;
  store.activateAtcoder('Alice');
  store.ingestAtcoder(atcoderProfile('Alice'), [submission(1, 'abc001_1', 'WA')]);
  const current = structuredClone(store.backup());
  const damaged = structuredClone(current);
  damaged.tables.problems.find((r: any) => r.profile.startsWith('ac~'))!.value.key = 'atcoder:wrong';
  assert.throws(() => store.restore(damaged));
  assert.deepEqual(store.backup().tables, current.tables);
  store.restore(v4);
  assert.equal(store.activeAtcoder(), '');
  assert.equal(store.problems('cfuser')[0].name, 'CF note');
  store.close();
});
