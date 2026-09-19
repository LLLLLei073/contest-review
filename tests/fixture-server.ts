// Test-only entrypoint. Production never loads or enables these fixtures.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import type { CFClient } from '../server/sync.js';
import type { CFSubmission } from '../shared/domain.js';
const names = [
  'Two Screens',
  'Turtle and a MEX Problem',
  'Longest Good Array',
  'Doremy’s Connecting Plan',
  'Beautiful Sequence',
  'Counting Paths',
  'Binary String Reconstruction',
  'Equalize',
];
const tags = [
  ['greedy', 'strings'],
  ['dp', 'number theory'],
  ['math', 'binary search'],
  ['graphs', 'dsu'],
  ['dp', 'combinatorics'],
  ['trees', 'dfs and similar'],
  ['constructive algorithms'],
  ['data structures', 'sortings'],
];
const submissions: CFSubmission[] = names
  .flatMap((name, i) => [
    {
      id: 100 + i * 2,
      contestId: 2000 + i,
      creationTimeSeconds: 1789600000 + i * 100,
      problem: {
        contestId: 2000 + i,
        index: i % 3 === 0 ? 'C' : 'B',
        name,
        tags: tags[i],
        rating: 1200 + i * 100,
      },
      verdict: i === 2 ? 'TIME_LIMIT_EXCEEDED' : 'WRONG_ANSWER',
      programmingLanguage: 'GNU C++20',
      author: { participantType: i === 3 ? 'PRACTICE' : i === 4 ? 'VIRTUAL' : 'CONTESTANT' },
    },
    ...(i % 2 === 0
      ? [
          {
            id: 101 + i * 2,
            contestId: 2000 + i,
            creationTimeSeconds: 1789600100 + i * 100,
            problem: {
              contestId: 2000 + i,
              index: i % 3 === 0 ? 'C' : 'B',
              name,
              tags: tags[i],
              rating: 1200 + i * 100,
            },
            verdict: 'OK',
            programmingLanguage: 'GNU C++20',
            author: { participantType: 'CONTESTANT' },
          },
        ]
      : []),
  ])
  .sort((a, b) => b.id - a.id);
const cf: CFClient = {
  async call<T>(method: string, params: Record<string, string | number> = {}) {
    if (Number(params.contestId) === 9000)
      return (await import('./cf-fixtures')).fixtureResult(method, params) as T;
    await new Promise((r) => setTimeout(r, 100));
    if (method === 'user.info') return [{ handle: String(params.handles) }] as T;
    if (method === 'user.status')
      return submissions.slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count)) as T;
    if (method === 'contest.list')
      return names.map((_, i) => ({
        id: 2000 + i,
        name: `Codeforces Round ${980 + i} (Div. 2)`,
        startTimeSeconds: 1789500000 + i * 86400,
      })) as T;
    if (method === 'problemset.problems') return { problems: submissions.map((s) => s.problem) } as T;
    if (method === 'user.rating')
      return [
        {
          contestId: 2000,
          contestName: 'Codeforces Round 980 (Div. 2)',
          oldRating: 1400,
          newRating: 1447,
          rank: 1200,
        },
      ] as T;
    return [] as T;
  },
};
const dir = mkdtempSync(join(tmpdir(), 'contest-review-e2e-'));
const { app } = await buildApp(new Store(join(dir, 'review.sqlite')), cf);
await app.listen({ host: '127.0.0.1', port: 3211 });
