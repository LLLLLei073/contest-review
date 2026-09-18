import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { SyncService, CodeforcesClient, type CFClient } from '../server/sync.js';
import { buildApp } from '../server/app.js';
import { emptyReview, nextReviewState, type CFSubmission, type SyncJob } from '../shared/domain.js';

const sub = (id: number, verdict = 'WRONG_ANSWER', index = 'A', type = 'CONTESTANT'): CFSubmission => ({
  id,
  contestId: 2000,
  creationTimeSeconds: 1700000000 + id,
  problem: { contestId: 2000, index, name: 'Test ' + index, tags: ['dp'] },
  verdict,
  programmingLanguage: 'GNU C++20',
  author: { participantType: type },
});
function store() {
  const s = new Store(':memory:');
  s.activate('tester');
  return s;
}
class FakeCF implements CFClient {
  submissions: CFSubmission[] = [];
  calls: { method: string; params: Record<string, string | number> }[] = [];
  failFrom = 0;
  insertAtSecond = false;
  async call<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'user.info') return [{ handle: String(params.handles) }] as T;
    if (method === 'user.status') {
      if (this.failFrom && Number(params.from) >= this.failFrom) throw new Error('fixture timeout');
      if (this.insertAtSecond && Number(params.from) > 1) {
        this.insertAtSecond = false;
        this.submissions.unshift(sub(100));
      }
      return this.submissions.slice(
        Number(params.from) - 1,
        Number(params.from) - 1 + Number(params.count),
      ) as T;
    }
    if (method === 'contest.status')
      return this.submissions
        .filter((s) => s.contestId === params.contestId)
        .slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count)) as T;
    if (method === 'problemset.problems') return { problems: [] } as T;
    if (method === 'contest.list')
      return [{ id: 2000, name: 'Fixture Round', startTimeSeconds: 1700000000 }] as T;
    return [] as T;
  }
}

test('failed then AC stays in notebook; later failure does not clear solved; notes survive reimport', () => {
  const s = store();
  s.ingest('tester', [sub(1), sub(2, 'OK'), sub(3, 'WRONG_ANSWER')]);
  assert.equal(s.problems('tester').length, 1);
  assert.equal(s.problems('tester')[0].solved, true);
  assert.equal(s.problems('tester')[0].failures, 2);
  s.saveReview('tester', '2000:A', { ...emptyReview(), solution: 'Personal solution', ignored: true });
  s.ingest('tester', [sub(1), sub(2, 'OK')]);
  assert.equal(s.all('submissions', 'tester').length, 3);
  assert.equal(s.review('tester', '2000:A').solution, 'Personal solution');
  assert.equal(s.review('tester', '2000:A').ignored, true);
  s.close();
});
test('pending and infrastructure/unknown verdicts are excluded; eventual failure included; rating nullable', () => {
  const s = store();
  for (const [i, v] of [
    'TESTING',
    'SUBMITTED',
    'FAILED',
    'CRASHED',
    'INPUT_PREPARATION_CRASHED',
    'SKIPPED',
    'REJECTED',
    'NEW_UNKNOWN',
  ].entries())
    s.ingest('tester', [sub(i + 1, v, String.fromCharCode(65 + i))]);
  assert.equal(s.problems('tester').length, 0);
  s.ingest('tester', [sub(1, 'TIME_LIMIT_EXCEEDED')]);
  assert.equal(s.problems('tester').length, 1);
  assert.equal(s.problems('tester')[0].rating, null);
  s.close();
});
test('all planned contest failure verdicts create notebook records', () => {
  const s = store();
  const values = [
    'WRONG_ANSWER',
    'TIME_LIMIT_EXCEEDED',
    'MEMORY_LIMIT_EXCEEDED',
    'RUNTIME_ERROR',
    'COMPILATION_ERROR',
    'PARTIAL',
    'CHALLENGED',
  ];
  values.forEach((v, i) => s.ingest('tester', [sub(i + 1, v, String.fromCharCode(65 + i))]));
  assert.equal(s.problems('tester').length, 7);
  s.close();
});
test('review schedule advances 3/7/14/30 days then mastery; hint preserves stage, failure resets', () => {
  const now = new Date('2026-09-18T08:00:00Z');
  let r = { ...emptyReview(), status: 'reviewing' as const };
  let state = nextReviewState(r, 'independent', now);
  assert.equal(state.stage, 1);
  assert.equal(state.nextReview, '2026-09-21T08:00:00.000Z');
  const hint = nextReviewState(state, 'hint', now);
  assert.equal(hint.stage, 1);
  assert.equal(hint.nextReview, '2026-09-19T08:00:00.000Z');
  assert.equal(nextReviewState(state, 'failed', now).stage, 0);
  for (const days of [7, 14, 30]) {
    state = nextReviewState(state, 'independent', now);
    assert.equal(new Date(state.nextReview!).getTime() - now.getTime(), days * 86400000);
  }
  state = nextReviewState(state, 'independent', now);
  assert.equal(state.status, 'mastered');
  assert.equal(state.nextReview, null);
  assert.equal(state.stage, 5);
});
test('review attempt atomic persistence and per-profile isolation', () => {
  const s = store();
  s.ingest('tester', [sub(1)]);
  assert.throws(() => s.attempt('tester', '2000:A', { result: 'independent', minutes: 5, note: '' }));
  s.saveReview('tester', '2000:A', {
    ...emptyReview(),
    status: 'reviewing',
    nextReview: '2026-09-01T00:00:00Z',
  });
  s.attempt(
    'tester',
    '2000:A',
    { result: 'independent', minutes: 10, note: 'Now understood' },
    new Date('2026-09-18T08:00:00Z'),
  );
  assert.equal(s.all('attempts', 'tester').length, 1);
  assert.equal(s.review('tester', '2000:A').stage, 1);
  s.activate('other');
  assert.equal(s.problems('other').length, 0);
  s.ingest('other', [sub(1)]);
  assert.equal(s.review('other', '2000:A').stage, 0);
  s.close();
});
test('statistics count unique problems and local-day due; practice alone is not participation', () => {
  const s = store();
  s.ingest('tester', [sub(1, 'WRONG_ANSWER', 'A', 'PRACTICE'), sub(2, 'WRONG_ANSWER', 'A', 'PRACTICE')]);
  s.saveReview('tester', '2000:A', {
    ...emptyReview(),
    status: 'reviewing',
    nextReview: '2026-09-18T21:00:00Z',
    reasons: ['边界遗漏', '边界遗漏'],
  });
  const stats = s.statistics('tester', new Date('2026-09-19T08:00:00Z'));
  assert.equal(stats.total, 1);
  assert.equal(stats.submissions, 2);
  assert.equal(stats.reasons[0][1], 1);
  assert.equal(stats.due, 1);
  assert.deepEqual(s.contests('tester')[0].types, ['PRACTICE']);
  s.close();
});
test('full sync, repeated full sync, incremental and history rejudge', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 12 }, (_, i) => sub(12 - i));
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  assert.throws(() => sync.start('tester', 'full'));
  await sync.running;
  assert.equal(s.latestJob('tester')!.status, 'completed');
  assert.equal(s.all('submissions', 'tester').length, 12);
  sync.start('tester', 'full');
  await sync.running;
  assert.equal(s.all('submissions', 'tester').length, 12);
  cf.submissions.unshift(sub(13, 'OK'));
  sync.start('tester', 'incremental');
  await sync.running;
  assert.equal(s.all('submissions', 'tester').length, 13);
  assert.equal(s.problems('tester')[0].solved, true);
  cf.submissions.find((s) => s.id === 1)!.verdict = 'OK';
  sync.start('tester', 'full');
  await sync.running;
  assert.equal(s.get<CFSubmission>('submissions', 'tester', '1')!.verdict, 'OK');
  s.close();
});
test('sync interruption preserves pages; resume handles shifted offsets without missing old submissions', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 14 }, (_, i) => sub(14 - i));
  cf.failFrom = 5;
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  await sync.running;
  assert.equal(s.latestJob('tester')!.status, 'failed');
  assert.equal(s.all('submissions', 'tester').length, 5);
  cf.failFrom = 0;
  cf.submissions.unshift(sub(15), sub(16));
  sync.start('tester', 'full', true);
  await sync.running;
  assert.equal(s.latestJob('tester')!.status, 'completed');
  assert.equal(s.all('submissions', 'tester').length, 16);
  s.close();
});
test('overlap handles new submissions shifting pagination; next sync picks up the new head', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 12 }, (_, i) => sub(12 - i));
  cf.insertAtSecond = true;
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  await sync.running;
  for (let i = 1; i <= 12; i++) assert.ok(s.get('submissions', 'tester', String(i)));
  sync.start('tester', 'incremental');
  await sync.running;
  assert.ok(s.get('submissions', 'tester', '100'));
  s.close();
});
test('incremental sync refreshes old pending verdict using contest status', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 20 }, (_, i) => sub(20 - i, 'OK'));
  cf.submissions[19] = sub(1, 'TESTING', 'B');
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  await sync.running;
  cf.submissions[19] = sub(1, 'WRONG_ANSWER', 'B');
  sync.start('tester', 'incremental');
  await sync.running;
  assert.ok(s.problems('tester').some((p) => p.key === '2000:B'));
  assert.ok(cf.calls.some((c) => c.method === 'contest.status'));
  s.close();
});
test('backup roundtrip, restart persistence, auto backup, malformed input fails without writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-test-')),
    path = join(dir, 'test.sqlite');
  let s = new Store(path);
  s.activate('tester');
  s.ingest('tester', [sub(1)]);
  s.saveReview('tester', '2000:A', { ...emptyReview(), solution: '$$x^2$$', code: 'int main(){}' });
  const backup = s.backup();
  s.close();
  s = new Store(path);
  assert.equal(s.review('tester', '2000:A').code, 'int main(){}');
  const invalid = structuredClone(backup);
  invalid.version = 99;
  assert.throws(() => s.restore(invalid));
  assert.equal(s.review('tester', '2000:A').solution, '$$x^2$$');
  const invalidRef = structuredClone(backup);
  invalidRef.tables.problems = [];
  assert.throws(() => s.restore(invalidRef));
  const duplicate = structuredClone(backup);
  duplicate.tables.problems.push(duplicate.tables.problems[0]);
  assert.throws(() => s.restore(duplicate));
  const result = s.restore(backup);
  assert.ok(result.backupPath);
  assert.equal(JSON.parse(readFileSync(result.backupPath!, 'utf8')).format, 'contest-review');
  assert.deepEqual(s.backup().tables, backup.tables);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  s.close();
  rmSync(dir, { recursive: true, force: true });
});
test('running sync job becomes interrupted after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-job-')),
    path = join(dir, 'test.sqlite');
  let s = new Store(path);
  s.activate('tester');
  const job: SyncJob = {
    id: 'job1',
    handle: 'tester',
    mode: 'full',
    status: 'running',
    processed: 5,
    cursor: 1,
    message: '',
    startedAt: new Date().toISOString(),
  };
  s.put('jobs', 'tester', 'job1', job);
  s.close();
  s = new Store(path);
  assert.equal(s.latestJob('tester')!.status, 'interrupted');
  s.close();
  rmSync(dir, { recursive: true, force: true });
});
test('CF requests serialized and retries bounded', async () => {
  let calls = 0,
    active = 0,
    maxActive = 0;
  const starts: number[] = [];
  const client = new CodeforcesClient(
    (async () => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 3));
      active--;
      return new Response(JSON.stringify({ status: 'OK', result: [] }));
    }) as typeof fetch,
    20,
  );
  await Promise.all([client.call('a'), client.call('b'), client.call('c')]);
  assert.equal(calls, 3);
  assert.equal(maxActive, 1);
  assert.ok(starts[1] - starts[0] >= 18);
});
test('API validation, origin/host guard, completion and manual date, search and backup', async () => {
  const s = store(),
    { app } = await buildApp(s, new FakeCF());
  const headers = { host: '127.0.0.1:3210', 'x-review-app': '1' };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/sync',
        headers: { ...headers, origin: 'https://evil.example' },
        payload: {},
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/settings', headers: { host: 'evil.example' } })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/problems', headers: { host: '127.0.0.1' }, payload: {} }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/problems',
        headers,
        payload: { contestId: 2000, index: 'B', name: 'Manual problem' },
      })
    ).statusCode,
    200,
  );
  const complete = await app.inject({
    method: 'PUT',
    url: '/api/problems/2000%3AB/review',
    headers,
    payload: { review: emptyReview(), action: 'complete' },
  });
  assert.equal(complete.json().status, 'reviewing');
  assert.ok(new Date(complete.json().nextReview).getTime() > Date.now());
  const date = '2026-12-01T01:00:00.000Z';
  await app.inject({
    method: 'PUT',
    url: '/api/problems/2000%3AB/review',
    headers,
    payload: { review: { ...complete.json(), nextReview: date }, action: 'save' },
  });
  assert.equal(s.review('tester', '2000:B').nextReview, date);
  assert.equal((await app.inject({ url: '/api/problems?q=Manual', headers })).json().total, 1);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/backup/restore', headers, payload: { version: 99 } }))
      .statusCode,
    400,
  );
  assert.equal(s.problems('tester').length, 1);
  await app.close();
  s.close();
});

test('incremental request after interrupted initial import still fetches all history', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 18 }, (_, i) => sub(18 - i));
  cf.failFrom = 5;
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  await sync.running;
  cf.failFrom = 0;
  const next = sync.start('tester', 'incremental');
  assert.equal(next.mode, 'full');
  await sync.running;
  assert.equal(s.all('submissions', 'tester').length, 18);
  s.close();
});
test('stopping sync preserves completed page and marks task interrupted', async () => {
  const s = store(),
    cf = new FakeCF();
  cf.submissions = Array.from({ length: 10 }, (_, i) => sub(10 - i));
  const sync = new SyncService(s, cf, 5);
  sync.start('tester', 'full');
  sync.stop();
  await sync.running;
  assert.equal(s.latestJob('tester')!.status, 'interrupted');
  assert.equal(s.all('submissions', 'tester').length, 5);
  s.close();
});
test('temporary metadata failure retains saved rating and contest notes', () => {
  const s = store();
  s.ingest('tester', [sub(1)]);
  const rating = { contestId: 2000, contestName: 'Round', oldRating: 1400, newRating: 1450, rank: 100 };
  s.enrich('tester', [{ id: 2000, name: 'Round' }], [rating], []);
  s.put('contest_reviews', 'tester', '2000', { timeAllocation: 'A: 10m', mistakes: '', improvements: '' });
  s.enrich('tester', [{ id: 2000, name: 'Round' }], [], []);
  assert.equal(s.contests('tester')[0].rating!.newRating, 1450);
  assert.equal(s.contests('tester')[0].review.timeAllocation, 'A: 10m');
  s.close();
});
test('CF retries stop after three failures', async () => {
  let calls = 0;
  const client = new CodeforcesClient(
    (async () => {
      calls++;
      return new Response(JSON.stringify({ status: 'FAILED', comment: 'Call limit exceeded' }));
    }) as typeof fetch,
    0,
  );
  await assert.rejects(client.call('user.info'), /Call limit exceeded/);
  assert.equal(calls, 3);
});
