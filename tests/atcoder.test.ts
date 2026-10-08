import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import {
  AtcoderService,
  AtcoderClient,
  atcoderProfile,
  atcoderNamespace,
  type AtcoderClientLike,
  type AtcoderSubmission,
  type AtcoderHistoryEntry,
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
  historyItems: AtcoderHistoryEntry[] = [];
  failingResource = '';
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
    if (name === this.failingResource) throw new Error('fixture metadata outage');
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
  async history(_handle: string) {
    return this.historyItems;
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

test('AtCoder pagination, repeat import, rejudge, account isolation and backup v7', async () => {
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
  assert.equal(backup.version, 8);
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

test('AtCoder legacy evaluation state repairs in the combined day and remains account-isolated', () => {
  const { store } = setup();
  const profile = atcoderProfile('Alice');
  const key = 'atcoder:abc001_1';
  store.ingestAtcoder(profile, [submission(1, 'abc001_1', 'WA')]);
  store.combinedTrainingDay(midday);
  store.ingestAtcoder(profile, [submission(2, 'abc001_1', 'AC')]);
  store.saveReview(profile, key, { ...store.review(profile, key), wrongIdea: '漏看条件' });
  store.attempt(profile, key, { result: 'independent', minutes: 8, note: '' }, midday);
  const evaluated = store.review(profile, key);
  store.put('reviews', profile, key, {
    ...evaluated,
    awaitingEvaluation: {
      date: localDay(midday),
      submissionId: 2,
      redoAt: midday.toISOString(),
      previousNextReview: evaluated.nextReview,
    },
    nextReview: null,
    firstReflectionAt: null,
  });
  const nextDay = new Store(':memory:');
  nextDay.restore(store.backup());
  assert.equal(nextDay.combinedTrainingDay(new Date(midday.getTime() + 86400000)).review.length, 0);
  nextDay.close();
  const day = store.combinedTrainingDay(midday);
  assert.equal(day.review.find((task) => task.key === key)?.phase, 'done');
  assert.equal(day.review.find((task) => task.key === key)?.completed, true);
  assert.equal(store.review(profile, key).nextReview, evaluated.nextReview);
  assert.equal(store.review(profile, key).stage, 1);
  store.activateAtcoder('Bob');
  assert.equal(
    store.combinedTrainingDay(midday).review.some((task) => task.key === key),
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

test('AtCoder official history confirms zero-submission participation and keeps performance separate', async () => {
  const { store, client, service } = setup();
  client.historyItems = [
    {
      IsRated: true,
      Place: 1873,
      OldRating: 242,
      NewRating: 242,
      Performance: 1399,
      ContestScreenName: 'abc001.contest.atcoder.jp',
      ContestName: 'Official ABC 001',
      EndTime: new Date((sec + 3600) * 1000).toISOString(),
    },
  ];
  service.start('Alice', 'full');
  await service.running;
  const row = service.contests()[0];
  assert.deepEqual(row.types, ['ATCODER_OFFICIAL']);
  assert.equal(row.inContestSolved, 0);
  assert.equal(row.officialPlace, 1873);
  assert.equal(row.officialPerformance, 1399);
  const report = service.report('abc001');
  assert.equal(report.official?.performance, 1399);
  assert.equal(report.official?.place, 1873);
  assert.equal(report.inContest.length, 0);
  assert.equal(report.solved, 0);
  assert.equal(report.windowAvailable, true);
  const v5 = {
    ...store.backup(),
    version: 5,
    external: store.backup().external.filter((r) => r.key !== 'history'),
  };
  store.restore(v5);
  assert.equal(service.contests().length, 0);
  store.close();
});

test('AtCoder catalog parts survive partial failure and forced refresh repairs a missing contest', async () => {
  const { store, client, service } = setup();
  client.items = [submission(1, 'abc001_1', 'WA', sec)];
  client.failingResource = 'contests';
  service.start('Alice', 'full');
  await service.running;
  assert.match(store.latestJob(atcoderProfile('Alice'))?.message ?? '', /比赛目录未补齐/);
  assert.equal(store.problems(atcoderProfile('Alice'))[0].name, 'Practice A');
  assert.equal(service.contests()[0].analysisStatus, '比赛资料待补齐');
  client.failingResource = '';
  const report = await service.refresh('abc001');
  assert.equal(report.windowAvailable, true);
  assert.equal(service.contests()[0].name, 'ABC Fixture');
  store.close();
});

test('AtCoder non-rated official record retains rank but treats zero performance as unavailable', async () => {
  const { store, client, service } = setup();
  client.historyItems = [
    {
      IsRated: false,
      Place: 12,
      OldRating: 500,
      NewRating: 500,
      Performance: 0,
      ContestScreenName: 'abc001.contest.atcoder.jp',
      ContestName: 'ABC',
      EndTime: new Date().toISOString(),
    },
  ];
  service.start('Alice', 'full');
  await service.running;
  assert.equal(service.contests()[0].officialPerformance, null);
  assert.equal(service.report('abc001').official?.rated, false);
  assert.equal(service.report('abc001').official?.performance, null);
  store.close();
});

test('AtCoder official history is isolated by account and stale contest catalog is refreshed', async () => {
  const { store, client, service } = setup();
  client.historyItems = [
    {
      IsRated: true,
      Place: 10,
      OldRating: 100,
      NewRating: 200,
      Performance: 700,
      ContestScreenName: 'abc001.contest.atcoder.jp',
      ContestName: 'ABC',
      EndTime: new Date().toISOString(),
    },
  ];
  service.start('Alice', 'full');
  await service.running;
  assert.equal(service.contests().length, 1);
  const catalog = store.externalGet<{
    fetchedAt: string;
    fetched: { contests: string };
    contests: unknown[];
  }>('atcoder-meta', 'catalog')!;
  store.externalPut('atcoder-meta', 'catalog', {
    ...catalog,
    contests: [],
    fetched: { ...catalog.fetched, contests: new Date(0).toISOString() },
  });
  client.historyItems = [];
  store.activateAtcoder('Bob');
  service.start('Bob', 'full');
  await service.running;
  assert.equal(service.contests().length, 0);
  assert.equal(store.externalGet<{ contests: unknown[] }>('atcoder-meta', 'catalog')?.contests.length, 1);
  store.activateAtcoder('Alice');
  assert.equal(service.contests()[0].officialPlace, 10);
  store.close();
});

test('Pages AtCoder client prefers the same-origin catalog and falls back if its snapshot is missing', async () => {
  const calls: string[] = [];
  const client = new AtcoderClient(
    async (url) => {
      calls.push(String(url));
      if (String(url).includes('/missing/')) return new Response('not found', { status: 404 });
      return Response.json([{ id: 'abc001' }]);
    },
    0,
    '/snapshot/',
  );
  assert.deepEqual(await client.resources('contests'), [{ id: 'abc001' }]);
  assert.deepEqual(calls, ['/snapshot/contests.json']);
  const fallback = new AtcoderClient(
    async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('/missing/')) return new Response('not found', { status: 404 });
      return Response.json([{ id: 'abc001' }]);
    },
    0,
    '/missing/',
  );
  assert.deepEqual(await fallback.resources('contests'), [{ id: 'abc001' }]);
  assert.equal(calls.at(-1), 'https://kenkoooo.com/atcoder/resources/contests.json');
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
