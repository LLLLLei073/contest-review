import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { LearningService } from '../shared/learning-service.js';
import { AiReviewer, type FetchLike } from '../shared/ai-review.js';
import {
  fingerprint,
  bundleSchema,
  type LearningRecord,
  type ExperienceCard,
} from '../shared/learning-domain.js';
import { knowledgeCards } from '../shared/knowledge.js';
import { localDay } from '../shared/core-store.js';
import type { CFSubmission } from '../shared/domain.js';
import type { DailyPlan } from '../shared/training.js';
import { stressFiles } from '../shared/stress.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function setup(
  respond: (data: Record<string, unknown>) => unknown | Promise<unknown> = () => ({ content: '检查边界' }),
) {
  const s = new Store(':memory:');
  s.activate('alice');
  const key = s.manualProblem('alice', {
    contestId: 2000,
    index: 'A',
    name: '二分边界',
    tags: ['binary search'],
    rating: 1000,
  });
  s.saveReview('alice', key, {
    ...s.review('alice', key),
    rootCause: '右端点遗漏',
    solution: '先证明单调谓词，维护二分循环不变量',
  });
  s.externalPut('ai', 'config', { baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'fixture' });
  let calls = 0;
  const fetch: FetchLike = async (_url, init) => {
    calls++;
    const req = JSON.parse((init as { body: string }).body);
    const data = JSON.parse(req.messages[1].content);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(await respond(data)) } }] }),
    };
  };
  const ai = new AiReviewer(fetch),
    l = new LearningService(s, ai);
  return { s, l, key, fetch, calls: () => calls };
}
function sub(id: number, key: string, verdict: string, at = new Date()): CFSubmission {
  const [contest, index] = key.split(':');
  return {
    id,
    contestId: Number(contest),
    creationTimeSeconds: Math.floor(at.getTime() / 1000),
    problem: { contestId: Number(contest), index, name: key, rating: 1000, tags: ['binary search'] },
    verdict,
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  };
}
function preparePlans(s: Store) {
  s.enrich(
    'alice',
    [],
    [],
    Array.from({ length: 30 }, (_, i) => ({
      contestId: 3000 + i,
      index: 'A',
      name: 'Candidate ' + i,
      rating: 1100 + (i % 3) * 100,
      tags: ['binary search', ...(i % 2 ? ['math'] : [])],
    })),
  );
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数据结构'] }, tomorrow);
  // 周日需同时保存当天目标。
  s.saveWeeklyGoal({ mode: 'focus', categories: ['数据结构'] });
  const today = s.combinedTrainingDay();
  return { tomorrow, today };
}

test('all eight domains have algorithm cards; drafts require confirmation; source updates invalidate citations', async () => {
  const { s, l, key } = setup((data) => ({
    answer: '二分右边界需要维护不变量',
    general: '通用建议',
    citationIds: (data.citations as { id: string }[]).slice(0, 2).map((c) => c.id),
  }));
  assert.equal(new Set(knowledgeCards.map((k) => k.category)).size, 8);
  const draft = (await l.draft({ problemKey: key })) as ExperienceCard;
  assert.ok(!l.search('右端点').some((c) => c.id === 'experience:' + draft.id));
  await l.editCard({ ...draft, confirmed: true });
  assert.ok(l.search('右端点').some((c) => c.id === 'experience:' + draft.id));
  const answer = (await l.ask({ question: '右端点 二分' })) as Extract<LearningRecord, { kind: 'answer' }>;
  assert.ok(answer.citations.length);
  s.saveReview('alice', key, { ...s.review('alice', key), rootCause: '来源修改' });
  assert.ok(!l.documents().some((c) => c.id === 'experience:' + draft.id));
  const saved = l.state().records.find((r) => r.id === answer.id);
  assert.ok(saved?.kind === 'answer' && saved.citations.some((c) => !c.valid));
  await assert.rejects(l.draft({ problemKey: key }), /手工编辑/);
  s.close();
});
test('RAG rejects fabricated citations, handles no matches, and personal data is isolated', async () => {
  const { s, l } = setup(() => ({ answer: '依据', general: '通用', citationIds: ['fabricated'] }));
  await assert.rejects(l.ask({ question: '二分' }), /未检索/);
  s.activate('bob');
  assert.ok(!l.search('右端点').some((c) => c.id.startsWith('problem:')));
  const noMatch = new LearningService(
    s,
    new AiReviewer(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify({ answer: '', general: '无资料解释', citationIds: [] }) } },
        ],
      }),
    })),
  );
  const answer = (await noMatch.ask({ question: 'zxqv-no-match' })) as Extract<
    LearningRecord,
    { kind: 'answer' }
  >;
  assert.equal(answer.citations.length, 0);
  assert.match(answer.answer, /未检索/);
  s.close();
});
test('graph derives curated prerequisite edges, source relations and confirmed personal cards', async () => {
  const { s, l, key } = setup();
  const d = (await l.draft({ problemKey: key })) as ExperienceCard;
  assert.ok(!l.graph().nodes.some((n) => n.id === 'experience:' + d.id));
  await l.editCard({ ...d, confirmed: true });
  const graph = l.graph();
  assert.ok(graph.edges.some((e) => e.relation === '前置知识'));
  assert.ok(graph.edges.some((e) => e.relation === '用户确认关联'));
  s.close();
});
test('diagnosis requires real evidence and valid knowledge IDs; sparse history has warnings', async () => {
  const { s, l, key } = setup((data) => ({
    findings: [
      {
        evidenceIds: [(data.evidence as { id: string }[])[0].id],
        cause: '边界遗漏',
        action: '练习不变量',
        knowledgeIds: ['binary-search'],
      },
    ],
    warnings: [],
  }));
  const empty = (await l.diagnose({ period: '30' })) as Extract<LearningRecord, { kind: 'diagnosis' }>;
  assert.equal(empty.findings.length, 0);
  s.ingest('alice', [sub(1, key, 'WRONG_ANSWER')]);
  const d = (await l.diagnose({ period: '30' })) as Extract<LearningRecord, { kind: 'diagnosis' }>;
  assert.ok(d.warnings.some((w) => w.includes('不足')));
  assert.equal(s.review('alice', key).stage, 0);
  s.close();
});
test('progressive hints are sequential, persisted and prevent independent stage advancement', async () => {
  const { s, l, key, calls } = setup();
  await assert.rejects(l.hint({ problemKey: key, statement: '输入整数 n，输出 n', level: 2 }), /顺序/);
  await l.hint({ problemKey: key, statement: '输入整数 n，输出 n', level: 1 });
  await l.hint({ problemKey: key, statement: '输入整数 n，输出 n', level: 1 });
  assert.equal(calls(), 1);
  s.ingest('alice', [sub(1, key, 'OK')]);
  const a = s.attempt('alice', key, { result: 'independent', minutes: 5, note: '' });
  assert.equal(a.result, 'hint');
  assert.equal(s.review('alice', key).stage, 0);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  s.ingest('alice', [sub(2, key, 'OK', tomorrow)]);
  s.combinedTrainingDay(tomorrow);
  const b = s.attempt('alice', key, { result: 'independent', minutes: 4, note: '' }, tomorrow);
  assert.equal(b.result, 'independent');
  assert.equal(s.review('alice', key).stage, 1);
  s.close();
});
test('late AI responses after account switch, ABA switch or restore never persist', async () => {
  for (const action of ['switch', 'aba', 'restore']) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { s, l, key } = setup(async () => {
      await gate;
      return { content: '提示' };
    });
    const pending = l.hint({ problemKey: key, statement: '题面', level: 1 });
    await new Promise((r) => setImmediate(r));
    if (action === 'restore') s.restore(s.backup());
    else {
      s.activate('bob');
      if (action === 'aba') s.activate('alice');
    }
    release();
    await assert.rejects(pending, /已变化/);
    s.activate('alice');
    assert.ok(!l.records().some((r) => r.kind === 'hint'));
    s.close();
  }
});
test('Agent changes only future plan; same inputs dedupe concurrent calls; revert does not reapply', async () => {
  const { s, l, calls } = setup((data) => ({
    keys: (data.candidates as { key: string }[])
      .slice(0, 5)
      .map((c) => c.key)
      .reverse(),
    reason: '针对边界短板训练',
  }));
  const { today, tomorrow } = preparePlans(s);
  l.preferences({ auto: true });
  const [r] = await Promise.all([l.agent({ automatic: true }), l.agent({ automatic: true })]);
  assert.equal(calls(), 1);
  const revision = r as Extract<LearningRecord, { kind: 'revision' }>;
  assert.equal(revision.kind, 'revision');
  assert.deepEqual(
    s.combinedTrainingDay().newProblems.map((p) => p.key),
    today.newProblems.map((p) => p.key),
  );
  assert.equal(s.combinedTrainingDay(tomorrow).newProblems.length, 5);
  l.revert({ id: revision.id });
  await l.agent({ automatic: true });
  assert.equal(calls(), 1);
  assert.deepEqual(
    s.get<DailyPlan>('daily_plans', 'alice', localDay(tomorrow))!.newKeys,
    revision.before.newKeys,
  );
  s.close();
});
test('Agent invalid model selection falls back; disabled auto never calls AI', async () => {
  const { s, l, calls } = setup(() => ({ keys: ['999999:X'], reason: 'bad' }));
  preparePlans(s);
  await l.agent({ automatic: true });
  assert.equal(calls(), 0);
  const r = (await l.agent({ automatic: false })) as { fallback: boolean };
  assert.equal(r.fallback, true);
  assert.ok(l.records().some((r) => r.kind === 'agent-run' && r.status === 'failed'));
  s.close();
});
test('migration occupies existing new slot; no repeated assignment; AC required and feedback recorded once', async () => {
  const { s, l, key } = setup();
  const { tomorrow } = preparePlans(s);
  const before = s.combinedTrainingDay(tomorrow);
  const t = (await l.transfer({ problemKey: key })) as Extract<LearningRecord, { kind: 'transfer' }>;
  assert.equal(t.kind, 'transfer');
  assert.ok(!before.newProblems.some((p) => p.key === t.targetKey));
  assert.ok(s.combinedTrainingDay(tomorrow).newProblems.some((p) => p.key === t.targetKey));
  assert.ok(s.combinedTrainingDay(tomorrow).newProblems.length <= 5);
  assert.throws(() => l.transferResult({ id: t.id, result: 'independent', minutes: 3 }), /AC/);
  s.ingest('alice', [sub(44, t.targetKey, 'OK', new Date(Date.now() + 2000))]);
  l.transferResult({ id: t.id, result: 'independent', minutes: 3 });
  assert.throws(() => l.transferResult({ id: t.id, result: 'independent', minutes: 3 }), /已评价/);
  assert.equal(s.review('alice', key).stage, 0);
  s.close();
});
test('v8 backup validates AI archives and learning references and restores legacy v1–v7', async () => {
  const { s, l, key } = setup();
  await l.draft({ problemKey: key });
  await l.hint({ problemKey: key, statement: '题面', level: 1 });
  const backup = s.backup();
  assert.equal(backup.version, 10);
  s.restore(backup);
  assert.equal(l.records().length, 2);
  const broken = structuredClone(backup);
  const r = broken.external.find((r) => r.namespace.startsWith('learning-source:'))!;
  r.key = 'bad';
  assert.throws(() => s.restore(broken), /编号/);
  assert.equal(l.records().length, 2);
  const legacy = s.backup();
  legacy.external = legacy.external.filter((r) => !r.namespace.startsWith('learning'));
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    const old = { ...structuredClone(legacy), version };
    s.restore(old);
    assert.ok(s.detail('alice', key));
  }
  s.close();
});
test('shared learning routes are available via local API without exposing AI secrets', async () => {
  const { s, fetch } = setup();
  const { app } = await buildApp(
    s,
    {
      async call<T>() {
        return [] as T;
      },
    },
    { aiFetch: fetch },
  );
  const state = await app.inject({ url: '/api/learning/state', headers: { host: '127.0.0.1:3210' } });
  assert.equal(state.statusCode, 200);
  assert.ok(!state.body.includes('apiKey'));
  assert.ok(state.json().knowledge.length >= 8);
  const response = await app.inject({
    method: 'POST',
    url: '/api/learning/search',
    headers: { host: '127.0.0.1:3210', 'x-review-app': '1' },
    payload: { query: '二分' },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().length);
  await app.close();
  s.close();
});

test('coach retains source evidence and isolates XCPC players without inventing individual logs', async () => {
  const { s, l } = setup((data) => ({
    findings: [
      {
        evidenceIds: [(data.evidence as { id: string }[])[0].id],
        cause: '以实际报告为依据',
        action: '练习边界',
        knowledgeIds: ['binary-search'],
      },
    ],
  }));
  s.activateAtcoder('bob');
  s.externalPut('atcoder:bob', 'report:abc123', { official: { place: 5 }, submissions: [] });
  const ac = (await l.coach({ source: 'atcoder', contestId: 'abc123' })) as Extract<
    LearningRecord,
    { kind: 'coach' }
  >;
  assert.equal(ac.contestKey, 'atcoder:abc123');
  s.setSetting('xcpc-active', 'one');
  s.externalPut('xcpc:one', 'report:regional', { teamName: 'Team One', solved: 5 });
  const x = (await l.coach({ source: 'xcpc', contestId: 'regional' })) as Extract<
    LearningRecord,
    { kind: 'coach' }
  >;
  assert.ok(x.warnings.some((w) => w.includes('不能推断个人')));
  s.setSetting('xcpc-active', 'two');
  assert.ok(!l.records().some((r) => r.id === x.id));
  s.setSetting('xcpc-active', 'one');
  assert.ok(l.records().some((r) => r.id === x.id));
  s.close();
});

test('AI transport and malformed output failures leave hints and knowledge unchanged', async () => {
  for (const mode of ['offline', 'malformed']) {
    const { s, key } = setup();
    const ai = new AiReviewer(async () => {
      if (mode === 'offline') throw new Error('offline');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'not-json' } }] }),
      };
    });
    const learning = new LearningService(s, ai);
    await assert.rejects(
      learning.hint({ problemKey: key, statement: '题面', level: 1 }),
      mode === 'offline' ? /无法连接/ : /格式异常/,
    );
    assert.equal(learning.records().length, 0);
    s.close();
  }
});

test('hint evidence remains attached to the AC day when evaluation is delayed', async () => {
  const { s, l, key } = setup();
  s.combinedTrainingDay();
  await l.hint({ problemKey: key, statement: '题面', level: 1 });
  s.ingest('alice', [sub(90, key, 'OK')]);
  s.combinedTrainingDay();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const attempt = s.attempt('alice', key, { result: 'independent', minutes: 10, note: '' }, tomorrow);
  assert.equal(attempt.result, 'hint');
  assert.equal(s.review('alice', key).stage, 0);
  s.close();
});
test(
  'downloaded Python/C++ scripts reproduce differences, success, crashes and timeouts',
  {
    skip: !process.env.LEARNING_TEST_PYTHON
      ? 'Set LEARNING_TEST_PYTHON for executable acceptance; core tests do not require compilers'
      : false,
  },
  () => {
    const python = process.env.LEARNING_TEST_PYTHON;
    assert.ok(python, 'Set LEARNING_TEST_PYTHON to a Python 3 executable for acceptance');
    const languages = ['python', 'cpp'] as const;
    const { s, l } = setup();
    for (const language of languages)
      for (const mode of ['passed', 'mismatch', 'crash', 'timeout'] as const) {
        const code =
          language === 'python'
            ? mode === 'passed'
              ? 'print(int(input())*2)'
              : mode === 'mismatch'
                ? 'print(int(input())*2+1)'
                : mode === 'crash'
                  ? 'raise RuntimeError("crash")'
                  : 'while True: pass'
            : mode === 'passed'
              ? '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<2*n;}'
              : mode === 'mismatch'
                ? '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<2*n+1;}'
                : mode === 'crash'
                  ? 'int main(){return 2;}'
                  : 'int main(){volatile int x=0;while(true){x=1;}}';
        const b = bundleSchema.parse({
          id: 'stress-fixture',
          createdAt: new Date().toISOString(),
          kind: 'bundle',
          problemKey: '2000:A',
          language,
          code,
          codeHash: fingerprint(code),
          oracle:
            language === 'python'
              ? 'print(int(input())*2)'
              : '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<2*n;}',
          generator: 'console.log((Number(process.argv[2])+Number(process.argv[3]))%10+1)',
        });
        const directory = mkdtempSync(join(tmpdir(), 'contest-stress-'));
        for (const [name, text] of Object.entries(stressFiles(b))) writeFileSync(join(directory, name), text);
        const r = spawnSync(
          process.execPath,
          [
            'run.mjs',
            '--python',
            python,
            '--seed',
            '7',
            '--rounds',
            '3',
            '--timeout',
            mode === 'timeout' ? '1000' : '3000',
          ],
          { cwd: directory, encoding: 'utf8', timeout: 65000, windowsHide: true },
        );
        assert.ok(!r.error, r.error?.message);
        const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
        assert.equal(report.status, mode, language + ': ' + report.message);
        s.externalPut('learning-source:alice', b.id, b);
        const imported = l.report(report) as Extract<LearningRecord, { kind: 'bundle' }>;
        assert.equal(imported.reports[0].status, mode);
        assert.equal(imported.status, 'user-verified');
        assert.throws(() => l.report({ ...report, codeHash: 'other-code' }), /不一致/);
        assert.equal(report.seed, 7);
        if (mode === 'mismatch') assert.equal(report.input.trim(), '8');
      }
    s.close();
  },
);
