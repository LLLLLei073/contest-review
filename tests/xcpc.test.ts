import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { SyncService, type CFClient } from '../shared/sync.js';
import { AnalysisService } from '../shared/analysis-service.js';
import { ContestHub } from '../shared/contest-hub.js';
import { XcpcClient, md5, xcpcAdvice, xcpcScore } from '../shared/xcpc.js';
import { buildApp } from '../server/app.js';

const a = '李同学@甲大学',
  b = '李同学@乙大学';
const history = (contestId: string, more: Record<string, unknown> = {}) => ({
  contestId,
  title: '区域赛 ' + contestId,
  startAt: '2025-11-01T09:00:00Z',
  teamName: '甲队',
  rank: 12,
  teamCount: 100,
  official: true,
  rated: true,
  ratedOfficial: true,
  perf: 1900,
  perfOfficial: 1850,
  rating_after: 1800,
  ratingAfterOfficial: 1780,
  rankOfficial: 10,
  teamCountOfficial: 80,
  solved: 5,
  tier: 'regional',
  ...more,
});
const player = (key: string) => ({
  key,
  name: '李同学',
  org: key.split('@')[1],
  contests: 2,
  history: [
    history('round_one', { dirt: 1.5 }),
    history('round_two', { startAt: '2026-01-01T09:00:00Z', perf: 2000, perfOfficial: 1950 }),
  ],
});
const contest = (slug: string) => ({
  id: slug,
  slug,
  title: '区域赛 ' + slug,
  startAt: '2025-11-01T09:00:00Z',
  category: 'ICPC',
  tier: 'regional',
  teamCount: 100,
  problems: [
    {
      alias: 'A',
      title: 'Easy',
      problemUrl: 'https://example.org/a',
      typeLabels: ['模拟'],
      accepted: 40,
      submitted: 100,
      solveRate: 0.4,
      problemRating: 1300,
    },
  ],
  teams: [
    {
      rank: 12,
      name: '甲队',
      org: '甲大学',
      solved: 5,
      penalty: 600,
      official: true,
      members: [{ key: a, name: '李同学' }],
      perf: 1900,
      perfOfficial: 1850,
      rankOfficial: 10,
    },
  ],
});
function fixture() {
  const calls: string[] = [];
  let fail = false;
  const fetcher: typeof fetch = async (input) => {
    const path = String(input);
    calls.push(path);
    if (fail && path.includes('/contests/')) throw new Error('offline');
    let data: unknown;
    if (path.includes('/search/players/'))
      data = [
        [a, '李同学', '甲大学', 2],
        [b, '李同学', '乙大学', 2],
      ];
    else if (path.endsWith('/contests-index.json'))
      data = [
        { slug: 'round_one', tier: 'regional' },
        { slug: 'round_two', tier: 'regional' },
      ];
    else if (path.includes('/players/')) data = { [a]: player(a), [b]: player(b) };
    else if (path.includes('/contests/')) data = contest(path.split('/').at(-1)!.replace('.json', ''));
    else throw new Error('unknown fixture');
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const store = new Store(':memory:');
  const cf: CFClient = {
    call: async () => {
      throw new Error('CF should not be called');
    },
  };
  const hub = new ContestHub(
    store,
    new SyncService(store, cf),
    new AnalysisService(store, cf),
    async () => {},
    new XcpcClient(fetcher, 0),
  );
  return {
    store,
    hub,
    calls,
    setFail: (v: boolean) => {
      fail = v;
    },
  };
}
async function waitReport(hub: ContestHub, slug: string) {
  for (let i = 0; i < 500; i++) {
    const result = hub.getReport(slug);
    if (result.task.status !== 'running') return result;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('report timed out');
}
test('XCPC search disambiguates school, binding works without CF, source score switches independently', async () => {
  const { store, hub } = fixture();
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  const choices = await hub.search('李同学');
  assert.deepEqual(
    choices.map((x) => x.org),
    ['甲大学', '乙大学'],
  );
  await hub.bind(a);
  assert.equal(store.active(), '');
  assert.equal(hub.rows().length, 2);
  assert.equal(store.externalGet<{ tier: string }>('xcpc:' + a, 'history:round_one')?.tier, 'regional');
  assert.equal(hub.rows()[0].analysisScore, 1950);
  hub.setMode('all');
  assert.equal(hub.rows()[0].analysisScore, 2000);
  await hub.bind(b);
  assert.equal(hub.active(), b);
  assert.equal(store.externalGet<{ key: string }>('player', a)?.key, a);
  store.close();
});
test('XCPC report retains notes and old cache on refresh failure; backup v4 restores archives', async () => {
  const { store, hub, setFail } = fixture();
  await hub.bind(a);
  hub.startReport('round_one');
  const result = await waitReport(hub, 'round_one');
  assert.ok(result.report);
  assert.equal(result.report!.detail.problems?.[0].alias, 'A');
  hub.saveReview('round_one', { timeAllocation: '开场慢', mistakes: '边界', improvements: '先测' });
  setFail(true);
  hub.startReport('round_one');
  const stale = await waitReport(hub, 'round_one');
  assert.equal(stale.task.status, 'failed');
  assert.equal(stale.report?.fetchedAt, result.report?.fetchedAt);
  const backup = store.backup();
  assert.equal(backup.version, 8);
  const bad = structuredClone(backup);
  bad.external.find((r) => r.key === 'report:round_one')!.value = {};
  assert.throws(() => store.restore(bad));
  const missing = structuredClone(backup);
  Reflect.deleteProperty(missing, 'external');
  assert.throws(() => store.restore(missing));
  assert.equal(hub.getReport('round_one').report?.fetchedAt, result.report?.fetchedAt);
  store.restore(backup);
  assert.equal(hub.rows().find((r) => r.id === 'round_one')?.review.improvements, '先测');
  store.close();
});
test('one-click review queues only missing reports, records partial failure, retry resumes', async () => {
  const { store, hub, calls, setFail } = fixture();
  await hub.bind(a);
  setFail(true);
  hub.startBatch();
  await hub.running;
  assert.equal(hub.latestJob()?.status, 'failed');
  assert.equal(hub.latestJob()?.processed, 2);
  setFail(false);
  hub.startBatch();
  await hub.running;
  assert.equal(hub.latestJob()?.status, 'completed');
  assert.equal(hub.latestJob()?.succeeded, 2);
  const before = calls.length;
  hub.startBatch();
  await hub.running;
  assert.equal(hub.latestJob()?.total, 0);
  assert.equal(calls.length, before + 2); // player and contest index are checked; completed reports are reused.
  store.close();
});
test('starred and unrated rows never invent official performance; advice uses only earlier same-tier samples', () => {
  assert.equal(xcpcScore(history('a', { official: false, perfOfficial: 2200 }), 'official'), null);
  assert.equal(xcpcScore(history('a', { official: false, perfOfficial: 2200 }), 'all'), 1900);
  assert.equal(xcpcScore(history('a', { rated: false }), 'all'), null);
  const prior = [
    history('old1', { startAt: '2025-01-01T09:00:00Z', firstATime: 10, rank: 20, rankOfficial: 20 }),
    history('old2', { startAt: '2025-02-01T09:00:00Z', firstATime: 20, rank: 30, rankOfficial: 30 }),
    history('old3', { startAt: '2025-03-01T09:00:00Z', firstATime: 30, rank: 40, rankOfficial: 40 }),
  ];
  const current = history('now', {
    startAt: '2025-04-01T09:00:00Z',
    firstATime: 35,
    rank: 50,
    rankOfficial: 50,
    dirt: 1,
  });
  const future = history('future', { startAt: '2026-01-01T09:00:00Z', firstATime: 200, rankPercent: 100 });
  const messages = xcpcAdvice(current, [...prior, current, future], 'official');
  assert.equal(messages.length, 3);
  assert.match(messages[1].evidence, /中位数 20 分钟/);
  assert.match(messages[2].evidence, /中位数前 36.9%/);
});
test('local API exposes independent XCPC binding, report and one-click status', async () => {
  const { store, hub } = fixture();
  const { app, hub: apiHub } = await buildApp(store, undefined, { xcpc: hub.xcpc });
  const headers = { host: '127.0.0.1:3210', 'x-review-app': '1' };
  const search = await app.inject({
    method: 'GET',
    url: '/api/xcpc/search?name=' + encodeURIComponent('李同学'),
    headers,
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().length, 2);
  const bind = await app.inject({ method: 'POST', url: '/api/xcpc/binding', headers, payload: { key: a } });
  assert.equal(bind.statusCode, 200);
  const rows = await app.inject({ method: 'GET', url: '/api/review/contests', headers });
  assert.equal(rows.json().length, 2);
  const start = await app.inject({ method: 'POST', url: '/api/review/batch', headers, payload: {} });
  assert.equal(start.statusCode, 200);
  await apiHub.running;
  assert.equal(apiHub.latestJob()?.status, 'completed');
  const report = await app.inject({ method: 'GET', url: '/api/xcpc/contests/round_one/analysis', headers });
  assert.equal(report.json().report.detail.slug, 'round_one');
  await app.close();
  store.close();
});
test('restoring a running one-click job marks it interrupted instead of leaving false progress', () => {
  const store = new Store(':memory:');
  store.externalPut('batch', 'pending-job', {
    id: 'pending-job',
    status: 'running',
    phase: '分析比赛',
    processed: 1,
    total: 3,
    succeeded: 1,
    failed: 0,
    errors: [],
    startedAt: '2026-09-25T00:00:00.000Z',
  });
  store.restore(store.backup());
  assert.equal(store.externalGet<{ status: string }>('batch', 'pending-job')?.status, 'interrupted');
  store.close();
});
