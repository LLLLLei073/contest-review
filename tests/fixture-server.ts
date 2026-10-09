// Test-only entrypoint. Production never loads or enables these fixtures.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import type { CFClient } from '../server/sync.js';
import type { CFSubmission } from '../shared/domain.js';
import { fixtureNewProblems } from './cf-fixtures.js';
import { learningReply } from './learning-fixture.js';
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
    if (method === 'problemset.problems')
      return { problems: [...submissions.map((s) => s.problem), ...fixtureNewProblems] } as T;
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
let astraFailureSeen = false;
const { app } = await buildApp(new Store(join(dir, 'review.sqlite')), cf, {
  aiFetch: async (url, init) => {
    if (url.endsWith('/models'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'fixture-model' }, { id: 'learning-fixture' }] }),
      };
    const request = JSON.parse((init as { body: string }).body);
    if (request.tools) {
      const user = String(request.messages.findLast((m: { role: string }) => m.role === 'user')?.content);
      if (user.includes('暂停测试')) await new Promise((resolve) => setTimeout(resolve, 800));
      if (user.includes('模拟失败') && !astraFailureSeen) {
        astraFailureSeen = true;
        throw new Error('Connection error.');
      }
      const change = user.includes('修改复盘');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'astra-fixture',
          object: 'chat.completion',
          created: 1,
          model: 'fixture',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message:
                request.messages.at(-1)?.role === 'tool'
                  ? { role: 'assistant', content: '星澪已查询真实学习记录。我们先讲直觉，再讲证明。' }
                  : {
                      role: 'assistant',
                      content: '',
                      tool_calls: [
                        {
                          id: 'snapshot',
                          type: 'function',
                          function: {
                            name: change ? 'propose_change' : 'learning_snapshot',
                            arguments: change
                              ? JSON.stringify({
                                  action: 'review',
                                  input: { problemKey: '9900:A', patch: { rootCause: '星澪帮助确认边界' } },
                                })
                              : '{}',
                          },
                        },
                      ],
                    },
            },
          ],
        }),
      };
    }
    const result = learningReply(request.messages[0].content, JSON.parse(request.messages[1].content));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }),
    };
  },
});
await app.listen({ host: '127.0.0.1', port: 3211 });
