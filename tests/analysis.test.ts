import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeContest, analysisCacheSchema } from '../shared/contest-analysis';
import { AnalysisService } from '../shared/analysis-service';
import { Store } from '../server/store';
import { buildApp } from '../server/app';
import { fixtureInput, submission, contest } from './analysis-fixtures';
import type { CFClient } from '../shared/sync';

test('fixed scoring: rank cohort, difficulty, failures before first AC and historical pace', () => {
  const report = analyzeContest(fixtureInput())[0];
  assert.deepEqual(
    report.parts.slice(0, 3).map((p) => p.score),
    [70, 70, 25],
  );
  assert.ok(Math.abs(report.parts[3].score! - 78.3333333333) < 1e-6);
  assert.equal(report.score, 62);
  assert.equal(report.performanceRating.value, 1400);
  assert.equal(report.performanceRating.method, 'rank');
  assert.equal(report.performanceRating.seed, 11);
  assert.equal(report.performanceRating.targetRank, 11);
  assert.equal(report.provisional, false);
  assert.equal(report.solved, 1);
  assert.equal(report.timeline[1].ac, null);
  assert.equal(report.advice.find((a) => a.id === 'repeat-A')?.submissionIds.length, 3);
  assert.ok(report.advice.some((a) => a.id === 'runtime'));
  assert.ok(report.advice.some((a) => a.id === 'upsolve-B'));
});

test('CF performance uses geometric mean rank, tied rated positions and rating bounds', () => {
  const data = fixtureInput();
  data.contest = { ...data.contest, rating: { ...data.contest.rating! } };
  data.cache!.standings.rows.forEach((r, i) => {
    if (r.party.members[0].handle !== 'tester') r.rank = i + 2;
  });
  data.cache!.standings.rows.find((r) => r.party.members[0].handle === 'tester')!.rank = 1;
  const stronger = analyzeContest(data)[0].performanceRating;
  assert.equal(stronger.method, 'rank');
  assert.ok(stronger.value! > 1400);
  assert.ok(Math.abs(stronger.targetRank! - Math.sqrt(11)) < 1e-9);
  data.cache!.standings.rows.forEach((r) => (r.rank = 1));
  const tied = analyzeContest(data)[0].performanceRating;
  assert.equal(tied.targetRank, 11);
  assert.equal(tied.value, 1400);
  data.cache!.ratings.forEach((r) => (r.oldRating = 4000));
  data.contest.rating!.oldRating = 4000;
  data.cache!.standings.rows.find((r) => r.party.members[0].handle === 'tester')!.rank = 1;
  data.cache!.standings.rows.forEach((r) => {
    if (r.party.members[0].handle !== 'tester') r.rank = 2;
  });
  assert.deepEqual(
    [analyzeContest(data)[0].performanceRating.value, analyzeContest(data)[0].performanceRating.bound],
    [4000, 'upper'],
  );
  data.cache!.ratings.forEach((r) => (r.oldRating = 1));
  data.contest.rating!.oldRating = 1;
  data.cache!.standings.rows.find((r) => r.party.members[0].handle === 'tester')!.rank = 99;
  data.cache!.standings.rows.forEach((r) => {
    if (r.party.members[0].handle !== 'tester') r.rank = 1;
  });
  assert.deepEqual(
    [analyzeContest(data)[0].performanceRating.value, analyzeContest(data)[0].performanceRating.bound],
    [0, 'lower'],
  );
});

test('difficulty fallback covers virtual and unrated rounds, but not incomplete or practice results', () => {
  const data = fixtureInput();
  data.contest = { ...data.contest, rating: undefined };
  data.cache!.standings.problems.push({ contestId: 9000, index: 'C', name: 'C', rating: 1600, tags: [] });
  data.problems.push({ contestId: 9000, index: 'C', name: 'C', rating: 1600, tags: [] });
  data.cache!.ratings = [];
  let report = analyzeContest(data)[0];
  assert.equal(report.performanceRating.method, 'difficulty');
  assert.equal(report.performanceRating.samples, 3);
  const oneAC = report.performanceRating.value!;
  data.submissions = [submission(40, 100, 'WRONG_ANSWER')];
  report = analyzeContest(data)[0];
  assert.ok(report.performanceRating.value! < oneAC);
  data.submissions = ['A', 'B', 'C'].map((index, i) => submission(50 + i, 100 + i, 'OK', index));
  report = analyzeContest(data)[0];
  assert.ok(report.performanceRating.value! > oneAC);
  data.submissions = [submission(60, 100, 'OK', 'A', 'VIRTUAL', 1731000000)];
  report = analyzeContest(data)[0];
  assert.equal(report.performanceRating.method, 'difficulty');
  data.cache!.standings.problems[1].rating = undefined;
  assert.equal(analyzeContest(data)[0].performanceRating.value, null);
  data.cache!.standings.problems[1].rating = 1400;
  data.submissions = [submission(60, 100, 'OK', 'A', 'PRACTICE')];
  data.cache!.standings.rows = [];
  assert.equal(analyzeContest(data).length, 0);
  data.submissions = [submission(60, 4000, 'OK', 'A', 'VIRTUAL', 1731000000)];
  report = analyzeContest(data)[0];
  assert.equal(report.solved, 0);
  assert.ok(report.performanceRating.value! < oneAC);
});
test('submission boundary, rejudgement, unknown, after-AC failure and duplicate AC', () => {
  const data = fixtureInput();
  data.submissions.push(
    submission(7, 3600, 'OK', 'B'),
    submission(8, -1, 'OK', 'B'),
    submission(9, 800, 'WRONG_ANSWER'),
    submission(10, 900, 'TESTING', 'B'),
    submission(11, 1000, 'CRASHED', 'B'),
  );
  let r = analyzeContest(data)[0];
  assert.equal(r.solved, 1);
  assert.equal(r.parts[2].score, 25);
  data.submissions.find((s) => s.id === 10)!.verdict = 'WRONG_ANSWER';
  r = analyzeContest(data)[0];
  assert.equal(r.parts[2].score, 20);
  data.submissions.find((s) => s.id === 4)!.verdict = 'CHALLENGED';
  data.submissions.find((s) => s.id === 5)!.verdict = 'CHALLENGED';
  r = analyzeContest(data)[0];
  assert.equal(r.solved, 0);
  assert.equal(r.parts[2].score, 0);
  assert.equal(r.parts[3].score, 0);
});
test('practice excluded, repeated virtual sessions separate, missing clock and team withheld', () => {
  const data = fixtureInput();
  data.contest = { ...contest, rating: undefined };
  data.cache!.standings.rows = [];
  data.submissions = [submission(1, 100, 'OK', 'A', 'PRACTICE')];
  assert.equal(analyzeContest(data).length, 0);
  data.submissions = [
    submission(1, 100, 'OK', 'A', 'VIRTUAL', 1731000000),
    submission(2, 200, 'OK', 'B', 'VIRTUAL', 1731100000),
  ];
  const reports = analyzeContest(data);
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.solved === 1 && r.official === null && r.parts[0].score === null));
  data.submissions[0].author.teamId = 1;
  assert.equal(analyzeContest(data).find((r) => r.session.start === 1731000000)!.score, null);
  assert.equal(
    analyzeContest(data).find((r) => r.session.start === 1731000000)!.performanceRating.value,
    null,
  );
  data.cache = undefined;
  data.contest = { id: 9000, name: 'Unknown' };
  data.submissions = [submission(1, 100)];
  assert.equal(analyzeContest(data)[0].submissions, 0);
  assert.equal(analyzeContest(data)[0].score, null);
});
test('tied midrank, insufficient cohort and difficulty coverage, provisional weighting', () => {
  const data = fixtureInput();
  data.cache!.standings.rows.forEach((r) => (r.rank = 1));
  let r = analyzeContest(data)[0];
  assert.equal(r.parts[0].score, 70);
  assert.equal(r.official!.percentile, 0.5);
  data.cache!.ratings = data.cache!.ratings.slice(0, 20);
  r = analyzeContest(data)[0];
  assert.equal(r.parts[0].score, null);
  assert.equal(r.eligibleWeight, 65);
  assert.equal(r.score, 58);
  assert.equal(r.provisional, true);
  delete data.cache!.standings.problems[1].rating;
  r = analyzeContest(data)[0];
  assert.equal(r.parts[1].score, null);
  assert.equal(r.score, null);
});
test('future ratings and future pace history never change an old report; incomplete history withheld', () => {
  const data = fixtureInput(),
    before = analyzeContest(data)[0];
  data.contests.push({
    ...contest,
    id: 9999,
    startTimeSeconds: 1732000000,
    rating: { ...contest.rating, ratingUpdateTimeSeconds: 1732010000, newRating: 3000 },
  });
  data.submissions.push(submission(30, 1, 'OK', 'A', 'CONTESTANT', 1732000000, 9999));
  assert.deepEqual(analyzeContest(data)[0], before);
  data.complete = false;
  assert.equal(analyzeContest(data)[0].parts[3].score, null);
  data.cache!.submissionsComplete = false;
  assert.ok(analyzeContest(data)[0].parts.every((p) => p.score === null));
  assert.equal(analyzeContest(data)[0].performanceRating.value, null);
});
test('unsettled contest is provisional; advice thresholds and no unsupported negative diagnosis', () => {
  const data = fixtureInput();
  data.cache!.standings.contest = { ...contest, phase: 'SYSTEM_TEST' };
  assert.equal(analyzeContest(data)[0].provisional, true);
  assert.equal(analyzeContest(data)[0].performanceRating.value, null);
  data.submissions = [submission(1, 100), submission(2, 200, 'OK', 'B')];
  assert.deepEqual(
    analyzeContest(data)[0].advice.map((a) => a.id),
    ['stable'],
  );
  data.submissions = [submission(1, 100, 'WRONG_ANSWER'), submission(2, 819, 'WRONG_ANSWER')];
  assert.ok(!analyzeContest(data)[0].advice.some((a) => a.id === 'gap-A'));
  data.submissions[1].creationTimeSeconds++;
  assert.ok(analyzeContest(data)[0].advice.some((a) => a.id === 'gap-A'));
});
function seeded() {
  const s = new Store(':memory:');
  s.activate('tester');
  const d = fixtureInput();
  s.ingest('tester', d.submissions);
  s.enrich(
    'tester',
    d.contests,
    d.contests.flatMap((c) => (c.rating ? [c.rating] : [])),
    d.problems,
  );
  return s;
}
test('rated or official zero-submission participation remains an analyzable contest, not practice', () => {
  const s = seeded(),
    data = fixtureInput();
  s.db.prepare('DELETE FROM submissions WHERE profile=?').run('tester');
  assert.ok(
    s
      .contests('tester')
      .find((c) => c.id === 9000)!
      .types.includes('CONTESTANT'),
  );
  s.put('analysis_cache', 'tester', '9000', analysisCacheSchema.parse(data.cache));
  assert.equal(s.contests('tester').find((c) => c.id === 9000)!.inContestSolved, 0);
  assert.equal(s.analysis('tester', 9000).sessions[0].solved, 0);
  s.close();
});
test('schema v1 migrates non-destructively; v1/v2/v3 backups roundtrip; corrupt cache rejected', () => {
  const s = seeded();
  s.put('analysis_cache', 'tester', '9000', analysisCacheSchema.parse(fixtureInput().cache));
  const v3 = s.backup();
  assert.equal(v3.version, 3);
  s.restore(v3);
  assert.deepEqual(s.backup().tables, v3.tables);
  const bad = structuredClone(v3);
  bad.tables.analysis_cache[0].value.id = 123;
  assert.throws(() => s.restore(bad));
  assert.deepEqual(s.backup().tables, v3.tables);
  const v2 = structuredClone(v3);
  v2.version = 2;
  Reflect.deleteProperty(v2, 'external');
  Reflect.deleteProperty(v2, 'xcpcActive');
  Reflect.deleteProperty(v2, 'xcpcMode');
  s.restore(v2);
  const legacy = structuredClone(v2);
  legacy.version = 1;
  delete legacy.tables.analysis_cache;
  s.restore(legacy);
  assert.equal(s.all('analysis_cache', 'tester').length, 0);
  const preserved = s.backup().tables;
  s.db.exec('DROP TABLE analysis_cache; DROP TABLE external; PRAGMA user_version=1');
  // Re-run migration on the same connection, as browser and server both do on opening existing data.
  return import('../shared/core-store').then(({ CoreStore }) => {
    const reopened = new CoreStore(s.db);
    assert.deepEqual(reopened.backup().tables, preserved);
    reopened.close();
  });
});
test('refresh shares one job, preserves cache on failure, isolates profiles and validates API', async () => {
  const s = seeded(),
    data = fixtureInput();
  let fail = false,
    calls = 0;
  const cf: CFClient = {
    async call<T>(method: string) {
      calls++;
      await new Promise((r) => setTimeout(r, 1));
      if (fail) throw new Error('offline');
      return (
        method === 'contest.standings'
          ? data.cache!.standings
          : method === 'contest.ratingChanges'
            ? data.cache!.ratings
            : method === 'contest.status'
              ? data.submissions.filter((x) => x.contestId === 9000)
              : { problems: data.problems }
      ) as T;
    },
  };
  const svc = new AnalysisService(s, cf);
  svc.start('tester', 9000);
  svc.start('tester', 9000);
  await svc.running;
  assert.equal(calls, 3);
  assert.equal(svc.get('tester', 9000).task.status, 'completed');
  const cached = s.get('analysis_cache', 'tester', '9000');
  fail = true;
  svc.start('tester', 9000);
  await svc.running;
  assert.equal(svc.get('tester', 9000).task.status, 'failed');
  assert.deepEqual(s.get('analysis_cache', 'tester', '9000'), cached);
  svc.reset();
  assert.equal(svc.get('tester', 9000).task.status, 'idle');
  s.activate('second');
  assert.throws(() => svc.get('second', 9000));
  s.activate('tester');
  const { app } = await buildApp(s, cf);
  const good = await app.inject('/api/contests/9000/analysis');
  assert.equal(good.statusCode, 200);
  assert.equal(good.json().handle, 'tester');
  assert.equal((await app.inject('/api/contests/no/analysis')).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/contests/9000/analysis/refresh',
        headers: { origin: 'https://evil.example' },
      })
    ).statusCode,
    403,
  );
  await app.close();
  s.close();
});
