import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { AgentService } from '../shared/agent-service.js';
import { ReviewWorkflowService } from '../shared/review-workflow.js';
import { workflowNamespace, type ReviewWorkflow } from '../shared/review-workflow-domain.js';
import type { AgentEvent, AgentRecord } from '../shared/agent-domain.js';
import type { FetchLike } from '../shared/ai-review.js';

type Body = { messages: { role: string; content: string; tool_call_id?: string }[] };
const call = (name: string, args: unknown) => ({
  role: 'assistant',
  content: '',
  tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
async function setup(respond?: (body: Body) => unknown) {
  const store = new Store(':memory:');
  store.activate('guided');
  const key = store.manualProblem('guided', {
    contestId: 9600,
    index: 'A',
    name: 'Unique observed boundary',
    rating: 1200,
    tags: ['binary search'],
  });
  store.externalPut('ai', 'config', {
    baseUrl: 'https://fixture.invalid/v1',
    apiKey: 'fixture',
    model: 'fixture',
  });
  const requests: Body[] = [];
  const fetch: FetchLike = async (_, init) => {
    const body = JSON.parse((init as { body: string }).body);
    requests.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'r' + requests.length,
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: respond?.(body) ?? { role: 'assistant', content: '未使用工具' },
          },
        ],
      }),
    };
  };
  const agent = new AgentService(store, fetch),
    workflows = new ReviewWorkflowService(store);
  const session = (await agent.route('sessions', 'POST', {
    context: { kind: 'problem', problemKey: key },
  })) as Extract<AgentRecord, { kind: 'session' }>;
  const workflow = (await agent.route('review/start', 'POST', { sessionId: session.id })) as ReviewWorkflow;
  const run = async (requestId = crypto.randomUUID()) => {
    const events: AgentEvent[] = [];
    for await (const e of agent.run({
      sessionId: session.id,
      workflowId: workflow.id,
      requestId,
      message: '继续当前检查点',
    }))
      events.push(e);
    return events;
  };
  return { store, key, agent, workflows, session, workflow, run, requests, fetch };
}
test('ReAct reads evidence, asks for missing input, uses the answer to search and proposes a confirmed-only change', async () => {
  let key = '',
    second = false,
    observed = false,
    searched = false;
  const f = await setup((body) => {
    const last = body.messages.at(-1)!;
    if (last.role !== 'tool') return call('review_context', {});
    if (last.tool_call_id === 'review_context') {
      const evidence = JSON.parse(last.content);
      assert.equal(evidence.problem.name, 'Unique observed boundary');
      observed = true;
      if (!second)
        return call('review_checkpoint', {
          summary: '已读取题目；缺少当时的思路。',
          question: '请描述你如何处理相等边界？',
          advance: true,
        });
      assert.match(JSON.stringify(body.messages[0].content), /left 等于 right 时循环未退出/);
      return call('search_knowledge', { query: '二分边界' });
    }
    if (last.tool_call_id === 'search_knowledge') {
      const citations = JSON.parse(last.content);
      assert.ok(citations.some((c: { title: string }) => c.title.includes('二分')));
      searched = true;
      return call('propose_change', {
        action: 'review',
        input: { problemKey: key, patch: { rootCause: '待验证：相等边界未使区间缩小' } },
      });
    }
    if (last.tool_call_id === 'propose_change')
      return call('review_checkpoint', {
        summary: '检索支持检查循环不变量；笔记尚待确认。',
        hypothesis: '相等边界未使区间缩小，尚未运行反例。',
        question: '能否提供最小输入与实际输出？',
        advance: false,
      });
    return { role: 'assistant', content: '请补充当前问题，之后继续验证。' };
  });
  key = f.key;
  try {
    const request = crypto.randomUUID();
    {
      const ev = await f.run(request);
      assert.equal(ev.at(-1)?.type, 'complete', JSON.stringify(ev));
    }
    assert.ok(observed);
    const count = f.requests.length;
    await f.run(request);
    assert.equal(f.requests.length, count);
    let w = f.workflows.read(f.workflow.id);
    assert.equal(w.status, 'waiting');
    assert.equal(w.stage, 'orient');
    const answer = { id: 'answer-1', version: w.version, text: 'left 等于 right 时循环未退出' };
    w = f.workflows.respond(w.id, answer);
    assert.equal(w.stage, 'recall');
    assert.equal(w.status, 'ready');
    assert.equal(f.workflows.respond(w.id, answer).answers.length, 1);
    second = true;
    {
      const ev = await f.run();
      assert.equal(ev.at(-1)?.type, 'complete', JSON.stringify(ev));
    }
    assert.ok(searched);
    w = f.workflows.read(w.id);
    assert.equal(w.status, 'waiting');
    assert.equal(w.advance, false);
    assert.ok(w.evidence.some((e) => e.status === 'hypothesis'));
    assert.equal(f.store.detail('guided', key)!.problem.review.rootCause, '');
    const proposal = f.agent.records().find((r) => r.kind === 'proposal');
    assert.equal(proposal?.kind, 'proposal');
    await f.agent.decide({ id: proposal!.id, approve: true });
    assert.equal(f.store.detail('guided', key)!.problem.review.rootCause, '待验证：相等边界未使区间缩小');
    assert.equal(f.store.detail('guided', key)!.problem.review.stage, 0);
  } finally {
    f.store.close();
  }
});
test('workflow requires fresh context and one response per version; isolation, cancellation, resume and backup remain conservative', async () => {
  const f = await setup();
  try {
    const w = f.workflow,
      begin = f.workflows.begin(w.id, f.session.id, 'first');
    assert.throws(() => f.workflows.begin(w.id, f.session.id, 'second'), /已执行/);
    const backup = f.store.backup();
    f.store.restore(backup);
    assert.equal(f.workflows.read(w.id).status, 'interrupted');
    assert.throws(() => f.workflows.respond(w.id, { id: 'a', version: 0, text: '继续' }), /已更新/);
    let r = f.workflows.respond(w.id, { id: 'a', version: begin.version, text: '重新查证' });
    assert.equal(r.status, 'ready');
    assert.equal(r.stage, 'orient');
    r = (await f.agent.route('review/' + w.id + '/cancel', 'POST')) as ReviewWorkflow;
    assert.equal(r.status, 'cancelled');
    r = f.workflows.respond(w.id, { id: 'b', version: r.version, text: '继续' });
    assert.equal(r.status, 'ready');
    f.store.activate('other');
    assert.throws(() => f.workflows.read(w.id), /不存在/);
    f.store.activate('guided');
    await f.agent.route('session', 'DELETE', { id: f.session.id });
    assert.equal(f.store.externalAll(workflowNamespace('guided', '')).length, 0);
  } finally {
    f.store.close();
  }
});
test('no-tool model yields interrupted workflow and cannot silently advance or claim completion', async () => {
  const f = await setup();
  try {
    const events = await f.run();
    assert.equal(events.at(-1)?.type, 'error');
    assert.match(events.at(-1)?.text ?? '', /检查点/);
    assert.equal(f.workflows.read(f.workflow.id).status, 'interrupted');
    assert.equal(f.store.detail('guided', f.key)!.problem.review.stage, 0);
    const backup = f.store.backup();
    const damaged = structuredClone(backup);
    const run = damaged.external.find((r) => (r.value as { kind?: string }).kind === 'run')!;
    (run.value as { workflowId: string }).workflowId = 'missing-workflow';
    assert.throws(() => f.store.restore(damaged), /复盘工作流/);
    assert.deepEqual(f.store.backup().tables, backup.tables);
    f.store.restore(backup);
    assert.equal(f.workflows.read(f.workflow.id).status, 'interrupted');
  } finally {
    f.store.close();
  }
});
test('checkpoint without reading context is rejected and repeated read is reused', async () => {
  let step = 0;
  const f = await setup((body) => {
    const last = body.messages.at(-1)!;
    if (step++ === 0)
      return call('review_checkpoint', { summary: '未读证据', question: '继续？', advance: true });
    if (step === 2) {
      assert.match(last.content, /先调用 review_context/);
      return call('review_context', {});
    }
    if (step === 3) return call('review_context', {});
    if (step === 4)
      return call('review_checkpoint', { summary: '已读证据', question: '请补充思路', advance: false });
    return { role: 'assistant', content: '等待补充。' };
  });
  try {
    {
      const ev = await f.run();
      assert.equal(ev.at(-1)?.type, 'complete', JSON.stringify(ev));
    }
    assert.equal(f.workflows.read(f.workflow.id).status, 'waiting');
  } finally {
    f.store.close();
  }
});
test('nested HTTP workflow routes use the same persisted state and never run a model on start/respond', async () => {
  const f = await setup();
  const { app } = await buildApp(f.store, undefined, { aiFetch: f.fetch });
  try {
    const start = await app.inject({
      method: 'POST',
      url: '/api/agent/review/start',
      payload: { sessionId: f.session.id },
      headers: { 'x-review-app': '1' },
    });
    assert.equal(start.statusCode, 200);
    assert.equal(start.json().id, f.workflow.id);
    const read = await app.inject({ method: 'GET', url: '/api/agent/review/' + f.workflow.id });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().status, 'ready');
    assert.equal(f.requests.length, 0);
  } finally {
    await app.close();
    f.store.close();
  }
});
