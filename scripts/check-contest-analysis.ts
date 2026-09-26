import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Store } from '../server/store';
import { CodeforcesClient, type CFClient } from '../shared/sync';
import { AnalysisService } from '../shared/analysis-service';
import { standingsSchema, ratingChangesSchema } from '../shared/contest-analysis';

// Real public APIs only; use an isolated in-memory database, never personal local data.
const contestId = Number(process.argv[2] ?? 2000),
  cf = new CodeforcesClient();
const standings = standingsSchema.parse(await cf.call('contest.standings', { contestId }));
const ratings = ratingChangesSchema.parse(await cf.call('contest.ratingChanges', { contestId }));
const ratingByHandle = new Map(ratings.map((r) => [r.handle.toLowerCase(), r]));
const candidates = standings.rows.filter(
  (r) =>
    r.party.participantType === 'CONTESTANT' &&
    r.party.members.length === 1 &&
    !r.party.teamId &&
    r.points > 0 &&
    (ratingByHandle.get(r.party.members[0].handle.toLowerCase())?.oldRating ?? 0) > 0,
);
const row = candidates[Math.floor(candidates.length / 2)];
assert.ok(row, 'No rated individual contestant available');
const handle = row.party.members[0].handle;
const cachedClient: CFClient = {
  async call<T>(method: string, params?: Record<string, string | number>) {
    return (
      method === 'contest.standings'
        ? standings
        : method === 'contest.ratingChanges'
          ? ratings
          : await cf.call(method, params)
    ) as T;
  },
};
const store = new Store(':memory:');
store.activate(handle);
store.put('contests', handle, String(contestId), standings.contest);
try {
  const service = new AnalysisService(store, cachedClient);
  service.start(handle, contestId);
  await service.running;
  const report = service.get(handle, contestId);
  assert.equal(report.task.status, 'completed', report.task.message);
  const official = report.sessions.find((s) => s.session.type === 'CONTESTANT');
  assert.ok(official);
  assert.equal(official.official?.rank, row.rank);
  assert.equal(official.official?.points, row.points);
  assert.equal(official.preRating, ratingByHandle.get(handle.toLowerCase())?.oldRating);
  assert.equal(official.performanceRating.method, 'rank');
  assert.ok(official.performanceRating.value !== null);
  assert.ok(
    official.timeline
      .flatMap((p) => p.events)
      .every((e) => e.seconds >= 0 && e.seconds < standings.contest.durationSeconds!),
  );
  const result = {
    verifiedAt: new Date().toISOString(),
    contestId,
    handle,
    officialRank: row.rank,
    officialPoints: row.points,
    preRating: official.preRating,
    solved: official.solved,
    submissions: official.submissions,
    score: official.score,
    performanceRating: official.performanceRating,
    parts: official.parts,
    task: report.task,
    warnings: official.warnings,
  };
  mkdirSync('test-results-pages', { recursive: true });
  writeFileSync('test-results-pages/real-contest-analysis.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  store.close();
}
