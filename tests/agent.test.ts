import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { AgentService } from '../shared/agent-service.js';
import { AiReviewer, type FetchLike } from '../shared/ai-review.js';
import { ASTRA_PERSONA } from '../shared/astra-model.js';
import type { AgentRecord, AgentEvent } from '../shared/agent-domain.js';
import { agentNamespace } from '../shared/agent-domain.js';
import { localDay } from '../shared/core-store.js';
type Request = { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] };
function fixture(
  respond: (body: Request) => unknown | Promise<unknown> = () => ({
    role: 'assistant',
    content: '一起把思路梳理清楚。',
  }),
) {
  const store = new Store(':memory:');
  store.activate('astra');
  const key = store.manualProblem('astra', {
    contestId: 9500,
    index: 'A',
    name: '边界练习',
    tags: ['binary search'],
    rating: 1200,
  });
  store.externalPut('ai', 'config', {
    baseUrl: 'https://fixture.invalid/v1',
    apiKey: 'fixture',
    model: 'fixture',
  });
  const requests: Request[] = [];
  const fetch: FetchLike = async (_, init) => {
    const b = JSON.parse((init as { body: string }).body);
    requests.push(b);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chat-' + requests.length,
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [{ index: 0, finish_reason: 'stop', message: await respond(b) }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
  };
  return { store, key, fetch, requests, service: new AgentService(store, fetch) };
}
async function session(service: AgentService, context: unknown = { kind: 'general' }) {
  return (await service.route('sessions', 'POST', { context })) as Extract<AgentRecord, { kind: 'session' }>;
}
async function run(service: AgentService, id: string, message = '你好', requestId = crypto.randomUUID()) {
  const events: AgentEvent[] = [];
  for await (const e of service.run({ sessionId: id, message, requestId })) events.push(e);
  return events;
}
test('LangChain tool loop, persona, request deduplication and account isolation', async () => {
  const f = fixture((b) =>
    b.messages.at(-1)?.role === 'tool'
      ? { role: 'assistant', content: '已根据真实证据查询学习进度。' }
      : {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'learning_snapshot', arguments: '{}' } },
          ],
        },
  );
  try {
    const s = await session(f.service),
      id = crypto.randomUUID();
    const events = await run(f.service, s.id, '我的学习进度如何？', id);
    assert.equal(events.at(-1)?.type, 'complete');
    assert.ok(events.some((e) => e.type === 'tool-start'));
    assert.ok(events.some((e) => e.type === 'text'));
    assert.match(JSON.stringify(f.requests[0].messages[0].content), /星澪/);
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests[0].tools?.some((t) => t.function.name === 'propose_change'));
    await run(f.service, s.id, '我的学习进度如何？', id);
    assert.equal(f.requests.length, 2);
    f.store.activate('other');
    assert.deepEqual(await f.service.route('sessions', 'GET'), []);
    await assert.rejects(() => run(f.service, s.id), /会话不存在/);
  } finally {
    f.store.close();
  }
});
test('explicit long term memory is manageable, can be disabled and survives backup', async () => {
  const f = fixture();
  try {
    const s = await session(f.service);
    await run(f.service, s.id, '请记住：我更喜欢先讲直觉再讲证明');
    let memories = (await f.service.route('memories', 'GET')) as Extract<AgentRecord, { kind: 'memory' }>[];
    assert.equal(memories.length, 1);
    await f.service.route('memory', 'PUT', { id: memories[0].id, content: '先讲直觉' });
    await f.service.route('settings', 'PUT', { memory: false, proactive: false });
    await run(f.service, s.id, '请记住：另一个目标');
    memories = (await f.service.route('memories', 'GET')) as typeof memories;
    assert.equal(memories.length, 1);
    const b = f.store.backup();
    assert.equal(b.version, 9);
    f.store.restore(b);
    assert.equal(((await f.service.route('memories', 'GET')) as typeof memories)[0].content, '先讲直觉');
    await f.service.route('memory', 'DELETE', { id: memories[0].id });
    assert.deepEqual(await f.service.route('memories', 'GET'), []);
    assert.ok(ASTRA_PERSONA.includes('AI 回答不是学习证据'));
  } finally {
    f.store.close();
  }
});
test('review proposals require approval, revalidate data and execute only once', async () => {
  let key = '';
  const f = fixture((b) =>
    b.messages.at(-1)?.role === 'tool'
      ? { role: 'assistant', content: '已准备具体变更，等待确认。' }
      : {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'change',
              type: 'function',
              function: {
                name: 'propose_change',
                arguments: JSON.stringify({
                  action: 'review',
                  input: { problemKey: key, patch: { rootCause: '二分边界' } },
                }),
              },
            },
          ],
        },
  );
  key = f.key;
  try {
    const s = await session(f.service);
    await run(f.service, s.id);
    const p = f.service.records().find((r) => r.kind === 'proposal');
    assert.ok(p && p.kind === 'proposal');
    assert.equal(f.store.review('astra', key).rootCause, '');
    assert.match(p.preview, /修改前/);
    assert.match(p.preview, /二分边界/);
    await f.service.decide({ id: p.id, approve: true });
    assert.equal(f.store.review('astra', key).rootCause, '二分边界');
    const at = f.store.review('astra', key).firstReflectionAt;
    await f.service.decide({ id: p.id, approve: true });
    assert.equal(f.store.review('astra', key).firstReflectionAt, at);
    await run(f.service, s.id);
    const second = f.service
      .records()
      .filter((r) => r.kind === 'proposal')
      .at(-1)!;
    f.store.saveReview('astra', key, { ...f.store.review('astra', key), solution: '用户新增的笔记' });
    await assert.rejects(() => f.service.decide({ id: second.id, approve: true }), /数据已变化/);
  } finally {
    f.store.close();
  }
});
test('problem assistance records hints, progress queries do not, restored proposals expire', async () => {
  const f = fixture();
  try {
    const s = await session(f.service, { kind: 'problem', problemKey: f.key });
    await run(f.service, s.id, '我的经验等级进度？');
    assert.equal(f.store.externalAll('learning-source:astra').length, 0);
    await run(f.service, s.id, '这道题的边界应该怎么思考？');
    assert.ok(f.store.externalAll<{ kind: string }>('learning-source:astra').some((r) => r.kind === 'hint'));
    const r = f.service.records().find((x) => x.kind === 'run')!;
    f.store.externalPut(f.service.namespace(), 'pending', {
      kind: 'proposal',
      id: 'pending',
      runId: r.id,
      sessionId: s.id,
      action: 'delete',
      input: { id: 'x' },
      preview: 'x',
      fingerprint: 'x',
      xcpc: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const b = f.store.backup();
    f.store.restore(b);
    assert.equal(
      (f.service.records().find((x) => x.id === 'pending') as { status: string }).status,
      'expired',
    );
    const bad = f.store.backup();
    bad.external!.push({
      namespace: agentNamespace('intruder', ''),
      key: 'settings',
      value: { kind: 'settings', id: 'settings', memory: true, proactive: false },
    });
    assert.throws(() => f.store.restore(bad), /账号组合/);
  } finally {
    f.store.close();
  }
});
test('capability probe detects unsupported models without affecting learning state', async () => {
  const f = fixture();
  try {
    const result = await new AiReviewer(f.fetch).capabilities({
      baseUrl: 'https://fixture.invalid/v1',
      apiKey: 'test',
      model: 'fixture',
    });
    assert.equal(result.toolCalling, false);
    assert.match(result.message, /结构化任务/);
    assert.equal(f.service.records().length, 0);
  } finally {
    f.store.close();
  }
});
test('native streaming API and browser service share the event contract', async () => {
  const f = fixture();
  const { app } = await buildApp(f.store, undefined, { aiFetch: f.fetch });
  try {
    const headers = { 'X-Review-App': '1' };
    const created = await app.inject({
      method: 'POST',
      url: '/api/agent/sessions',
      headers,
      payload: { context: { kind: 'general' } },
    });
    assert.equal(created.statusCode, 200);
    const result = await app.inject({
      method: 'POST',
      url: '/api/agent/run',
      headers,
      payload: { sessionId: created.json().id, requestId: crypto.randomUUID(), message: '你好' },
    });
    assert.equal(result.statusCode, 200);
    assert.match(String(result.headers['content-type']), /ndjson/);
    const events = result.body
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x));
    assert.equal(events.at(-1).type, 'complete');
  } finally {
    await app.close();
    f.store.close();
  }
});
test('cancelling a pending model call retains the user message and does not save an answer', async () => {
  let release: (v: unknown) => void = () => {};
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  try {
    const s = await session(f.service);
    const pending = run(f.service, s.id, '你好');
    while (!f.requests.length) await new Promise((resolve) => setTimeout(resolve, 1));
    await assert.rejects(() => run(f.service, s.id, '另一条消息'), /正在生成/);
    await f.service.route('cancel', 'POST', { sessionId: s.id });
    release({ role: 'assistant', content: '不应保存' });
    const events = await pending;
    assert.equal(events.at(-1)?.type, 'error');
    assert.equal(f.service.records().filter((r) => r.kind === 'message' && r.role === 'assistant').length, 0);
    assert.equal(
      (f.service.records().find((r) => r.kind === 'run') as { status: string }).status,
      'cancelled',
    );
  } finally {
    f.store.close();
  }
});
test('account switch while awaiting a model result cannot save to the new account', async () => {
  let release: (v: unknown) => void = () => {};
  const f = fixture(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  try {
    const s = await session(f.service);
    const pending = run(f.service, s.id);
    while (!f.requests.length) await new Promise((resolve) => setTimeout(resolve, 1));
    f.store.activate('new_owner');
    release({ role: 'assistant', content: '旧账号的内容' });
    await pending;
    assert.deepEqual(f.service.records(), []);
  } finally {
    f.store.close();
  }
});
test('proactive advice is opt in, deduplicated, dismissible and limited to two daily requests', async () => {
  const f = fixture();
  try {
    assert.equal(await f.service.suggest({}), null);
    assert.equal(f.requests.length, 0);
    await f.service.route('settings', 'PUT', { memory: true, proactive: true });
    const first = await f.service.suggest({});
    assert.ok(first);
    await f.service.suggest({});
    assert.equal(f.requests.length, 1);
    await f.service.route('dismiss', 'POST', { id: first.id });
    assert.equal(await f.service.suggest({}), null);
    f.store.saveReview('astra', f.key, { ...f.store.review('astra', f.key), rootCause: '第一次变化' });
    assert.ok(await f.service.suggest({}));
    f.store.saveReview('astra', f.key, { ...f.store.review('astra', f.key), rootCause: '第二次变化' });
    assert.equal(await f.service.suggest({}), null);
    assert.equal(f.requests.length, 2);
  } finally {
    f.store.close();
  }
});
test('model call limit stops repeated tool requests without fabricating completion', async () => {
  const f = fixture(() => ({
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: crypto.randomUUID(), type: 'function', function: { name: 'learning_snapshot', arguments: '{}' } },
    ],
  }));
  try {
    const s = await session(f.service);
    const e = await run(f.service, s.id);
    assert.equal(e.at(-1)?.type, 'error');
    assert.ok(f.requests.length <= 6);
    assert.equal((f.service.records().find((r) => r.kind === 'run') as { status: string }).status, 'failed');
  } finally {
    f.store.close();
  }
});
test('hint evidence is separate for two problems in the same Beijing day and attempt session', async () => {
  const f = fixture();
  try {
    const second = f.store.manualProblem('astra', {
      contestId: 9501,
      index: 'A',
      name: '另一题',
      tags: ['math'],
      rating: 1000,
    });
    const a = await session(f.service, { kind: 'problem', problemKey: f.key }),
      b = await session(f.service, { kind: 'problem', problemKey: second });
    await run(f.service, a.id, '请讲讲思路');
    await run(f.service, b.id, '请讲讲思路');
    assert.equal(
      f.store.externalAll<{ kind: string }>('learning-source:astra').filter((r) => r.kind === 'hint').length,
      2,
    );
  } finally {
    f.store.close();
  }
});
test('future plan approval applies the exact generated preview without another model request', async () => {
  const f = fixture((b) => {
    if (!b.tools) {
      const data = JSON.parse(b.messages[1].content) as { candidates: { key: string }[] };
      return {
        role: 'assistant',
        content: JSON.stringify({
          keys: data.candidates
            .slice(0, 5)
            .map((p) => p.key)
            .reverse(),
          reason: '保持目标覆盖，复核边界',
        }),
      };
    }
    return b.messages.at(-1)?.role === 'tool'
      ? { role: 'assistant', content: '未来题单方案已准备好，等待确认。' }
      : {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'plan',
              type: 'function',
              function: { name: 'propose_change', arguments: JSON.stringify({ action: 'agent', input: {} }) },
            },
          ],
        };
  });
  try {
    f.store.enrich(
      'astra',
      [],
      [],
      Array.from({ length: 30 }, (_, i) => ({
        contestId: 9600 + i,
        index: 'A',
        key: 9600 + i + ':A',
        name: '新知' + i,
        rating: 1200,
        tags: ['math'],
      })),
    );
    const tomorrow = new Date(Date.now() + 86400000);
    f.store.saveWeeklyGoal({ mode: 'focus', categories: ['数学'] }, tomorrow);
    f.store.combinedTrainingDay(tomorrow);
    const keys = () => f.store.combinedTrainingDay(tomorrow).newProblems.map((p) => p.key);
    const before = keys(),
      s = await session(f.service);
    await run(f.service, s.id, '请调整未来题单');
    const p = f.service.records().find((r) => r.kind === 'proposal');
    assert.ok(p && p.kind === 'proposal');
    assert.deepEqual(keys(), before);
    const planned = (p.input.revision as { after: { newKeys: string[] } }).after.newKeys;
    const count = f.requests.length;
    await f.service.decide({ id: p.id, approve: true });
    assert.deepEqual(keys(), planned);
    assert.equal(f.requests.length, count);
    assert.equal(localDay(tomorrow), (p.input.revision as { date: string }).date);
  } finally {
    f.store.close();
  }
});
