import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { PlanningService } from '../shared/planning-service';
import { buildApp } from '../server/app';
import { emptyReview, type CFSubmission } from '../shared/domain';
import { fingerprint } from '../shared/learning-domain';
import { agentNamespace } from '../shared/agent-domain';
import { workflowNamespace, type ReviewWorkflow } from '../shared/review-workflow-domain';
import { plannerOutcomes } from '../shared/planner-outcomes';
const now = new Date('2026-10-14T04:00:00Z');
const request = { date: '2026-10-15', budget: 90, targets: [] };
function setup() {
  const store = new Store(':memory:');
  store.activate('planner');
  store.enrich(
    'planner',
    [],
    [],
    Array.from({ length: 20 }, (_, i) => ({
      contestId: 6000 + i,
      index: 'A',
      name: `Candidate ${i}`,
      rating: 1100,
      tags: i % 2 ? ['dp'] : ['implementation'],
    })),
  );
  store.saveWeeklyGoal({ mode: 'focus', categories: ['实现与模拟'] }, now);
  const planner = new PlanningService(store, () => now);
  return { store, planner };
}
test('future-week goals are explicit and follow-up metrics exclude future and assisted evidence', () => {
  const { store, planner } = setup();
  try {
    const today = store.combinedTrainingDay(now);
    planner.route('goal', 'POST', { date: '2026-10-19', mode: 'focus', categories: ['实现与模拟'] });
    const preview = planner.preview({ ...request, date: '2026-10-19' });
    assert.equal(preview.result.feasible, true);
    planner.apply({ id: preview.id });
    assert.deepEqual(store.combinedTrainingDay(now).newProblems, today.newProblems);
    const decision = planner.state().decisions[0],
      key = decision.after.newKeys[0];
    const attempts = [
      {
        id: 'a',
        problemKey: key,
        createdAt: '2026-10-19T01:00:00Z',
        result: 'independent' as const,
        minutes: 30,
        note: '',
      },
      {
        id: 'future',
        problemKey: decision.after.newKeys[1],
        createdAt: '2026-10-20T01:00:00Z',
        result: 'independent' as const,
        minutes: 20,
        note: '',
      },
    ];
    const obs = attempts.map((a) => ({
      id: a.id,
      problemKey: a.problemKey,
      session: 'session',
      at: a.createdAt,
      skillIds: ['simulation'],
      result: a.result,
      accepted: true,
      assisted: false,
    }));
    const report = plannerOutcomes([decision], attempts, obs, '2026-10-19T02:00:00Z')[0];
    assert.equal(report.evaluated, 1);
    assert.equal(report.minutes, 30);
    assert.equal(report.independentPerHour, 2);
    obs[0].assisted = true;
    assert.equal(plannerOutcomes([decision], attempts, obs, '2026-10-19T02:00:00Z')[0].independent, 0);
    attempts[0].minutes = 0;
    assert.equal(
      plannerOutcomes([decision], attempts, obs, '2026-10-19T02:00:00Z')[0].independentPerHour,
      null,
    );
  } finally {
    store.close();
  }
});
test('preview leaves all daily plans untouched; apply and revert preserve today, isolate accounts and dedupe apply', () => {
  const { store, planner } = setup();
  try {
    const today = store.combinedTrainingDay(now);
    const plans = fingerprint(store.all('daily_plans', 'planner'));
    const preview = planner.preview(request);
    assert.equal(preview.result.feasible, true);
    assert.equal(preview.result.allocatedMinutes <= 90, true);
    assert.equal(preview.result.selected.filter((c) => c.goal).length >= 2, true);
    assert.equal(fingerprint(store.all('daily_plans', 'planner')), plans);
    assert.equal(planner.readPlan(request.date), null);
    planner.apply({ id: preview.id });
    assert.deepEqual(planner.apply({ id: preview.id }).after, preview.after);
    assert.deepEqual(store.combinedTrainingDay(now).newProblems, today.newProblems);
    assert.deepEqual(planner.readPlan(request.date), preview.after);
    planner.revert({ id: preview.id });
    assert.equal(planner.readPlan(request.date), null);
    store.activate('other');
    assert.throws(() => planner.apply({ id: preview.id }), /不存在|账号/);
    assert.equal(planner.state().decisions.length, 0);
  } finally {
    store.close();
  }
});
test('budget conflict, stale evidence, changed catalog, changed goal and current dates never mutate a plan', () => {
  for (const change of ['evidence', 'catalog', 'goal', 'preferences']) {
    const { store, planner } = setup();
    try {
      const short = planner.preview({ ...request, budget: 15 });
      assert.equal(short.result.feasible, false);
      assert.equal(short.result.minimumMinutes, 70);
      assert.throws(() => planner.apply({ id: short.id }), /冲突/);
      const preview = planner.preview(request);
      if (change === 'evidence')
        store.manualProblem('planner', {
          contestId: 300,
          index: 'A',
          name: 'New evidence',
          rating: 1100,
          tags: ['dp'],
        });
      if (change === 'catalog')
        store.enrich(
          'planner',
          [],
          [],
          [{ contestId: 8000, index: 'A', name: 'Replaced', rating: 1100, tags: ['dp'] }],
        );
      if (change === 'goal') store.saveWeeklyGoal({ mode: 'focus', categories: ['动态规划'] }, now);
      if (change === 'preferences') planner.preferences({ budget: 120, targets: ['dp'] });
      assert.throws(() => planner.apply({ id: preview.id }), /已变化/);
      assert.equal(planner.readPlan(request.date), null);
      assert.throws(() => planner.preview({ ...request, date: '2026-10-14' }), /未来/);
      assert.throws(() => planner.preview({ ...request, date: '2026-02-30' }));
    } finally {
      store.close();
    }
  }
});
test('tracing reads only verified and attributed evidence; assisted and mixed attempts do not inflate skill state', () => {
  const { store, planner } = setup();
  try {
    const key = store.manualProblem('planner', {
      contestId: 42,
      index: 'A',
      name: 'Implementation',
      rating: 1000,
      tags: ['implementation'],
    });
    const submission: CFSubmission = {
      id: 42,
      contestId: 42,
      creationTimeSeconds: Date.parse('2026-10-13T03:00:00Z') / 1000,
      problem: { contestId: 42, index: 'A', name: 'Implementation', tags: ['implementation'] },
      verdict: 'OK',
      programmingLanguage: 'C++',
      author: { participantType: 'PRACTICE' },
    };
    store.put('submissions', 'planner', '42', submission);
    store.put('attempts', 'planner', 'attempt', {
      id: 'attempt',
      problemKey: key,
      result: 'independent',
      minutes: 20,
      note: '',
      createdAt: '2026-10-13T04:00:00Z',
    });
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 1);
    const snapshot = planner.tracing();
    snapshot.states.find((s) => s.skillId === 'simulation')!.samples = 999;
    snapshot.parameters.initial = 1;
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 1);
    assert.equal(planner.tracing().parameters.initial, 0.2);
    const beforeEvidence = new PlanningService(store, () => new Date('2026-10-13T02:00:00Z'));
    assert.equal(beforeEvidence.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 0);
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 1);
    store.activate('other');
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 0);
    store.activate('planner');
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 1);
    store.put('submissions', 'planner', '42', { ...submission, author: { ...submission.author, teamId: 7 } });
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 0);
    store.put('submissions', 'planner', '42', submission);
    store.externalPut('learning-source:planner', 'hint', {
      kind: 'hint',
      id: 'hint',
      problemKey: key,
      session: '2026-10-13:first',
      level: 1,
      content: '提示',
      createdAt: '2026-10-13T02:00:00Z',
    });
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 0);
    store.externalDelete('learning-source:planner', 'hint');
    store.put('submissions', 'planner', '42', { ...submission, verdict: 'WRONG_ANSWER' });
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 0);
    store.put('attempts', 'planner', 'attempt', {
      id: 'attempt',
      problemKey: key,
      result: 'failed',
      minutes: 20,
      note: '',
      createdAt: '2026-10-13T04:00:00Z',
    });
    assert.equal(planner.tracing().states.find((s) => s.skillId === 'simulation')!.samples, 1);
  } finally {
    store.close();
  }
});
test('combined accounts render the chosen future plan without replacing the CF-only schedule', () => {
  const { store, planner } = setup();
  try {
    const future = new Date('2026-10-15T04:00:00Z');
    const original = store.combinedTrainingDay(future);
    const sourcePlan = store.get('daily_plans', 'planner', request.date);
    store.activateAtcoder('practice');
    store.saveWeeklyGoal({ mode: 'focus', categories: ['实现与模拟'] }, now);
    const preview = planner.preview({ ...request, budget: 70 });
    planner.apply({ id: preview.id });
    assert.deepEqual(
      store.combinedTrainingDay(future).newProblems.map((p) => p.key),
      preview.after.newKeys,
    );
    assert.deepEqual(store.get('daily_plans', 'planner', request.date), sourcePlan);
    assert.equal(original.newProblems.length, 5);
    planner.revert({ id: preview.id });
    assert.equal(planner.readPlan(request.date), null);
  } finally {
    store.close();
  }
});
test('only AtCoder and missing weekly goals still produce conservative review plans', () => {
  const store = new Store(':memory:');
  try {
    store.activateAtcoder('practice');
    store.put('problems', 'ac~practice', 'atcoder:abc1_a', {
      key: 'atcoder:abc1_a',
      contestId: null,
      index: 'atcoder:abc1_a',
      name: 'AC practice',
      rating: null,
      tags: [],
      url: 'https://atcoder.jp/contests/abc1/tasks/abc1_a',
      manual: true,
      source: 'atcoder',
    });
    store.put('reviews', 'ac~practice', 'atcoder:abc1_a', emptyReview());
    const planner = new PlanningService(store, () => now);
    const preview = planner.preview(request);
    assert.equal(preview.after.newKeys.length, 0);
    assert.equal(preview.after.review.length, 1);
    planner.apply({ id: preview.id });
    assert.deepEqual(planner.readPlan(request.date), preview.after);
    planner.revert({ id: preview.id });
    assert.equal(planner.readPlan(request.date), null);
  } finally {
    store.close();
  }
});
test('v11 backups preserve planning history, expire previews and interrupt running guided reviews atomically', () => {
  const { store, planner } = setup();
  try {
    planner.preferences({ budget: 90, targets: ['simulation'] });
    const preview = planner.preview(request);
    const sessionId = 'session',
      context = { kind: 'general' as const },
      agentScope = agentNamespace('planner', '');
    store.externalPut(agentScope, sessionId, {
      id: sessionId,
      kind: 'session',
      title: 'Review',
      context,
      xcpc: '',
      createdAt: now.toISOString(),
    });
    const workflow: ReviewWorkflow = {
      kind: 'workflow',
      id: 'workflow',
      scope: workflowNamespace('planner', ''),
      sessionId,
      context,
      xcpc: '',
      stage: 'recall',
      advance: false,
      status: 'running',
      version: 1,
      fingerprint: 'source',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      question: '原思路是什么？',
      summary: '读取提交',
      answers: [],
      evidence: [],
      proposalIds: [],
    };
    store.externalPut(workflow.scope, workflow.id, workflow);
    const backup = store.backup();
    assert.equal(backup.version, 12);
    store.restore(backup);
    assert.equal(planner.state().decisions.find((d) => d.id === preview.id)!.status, 'expired');
    assert.equal(store.externalGet<ReviewWorkflow>(workflow.scope, workflow.id)!.status, 'interrupted');
    const stable = fingerprint(store.backup().tables);
    for (const corruption of ['owner', 'session', 'proposal', 'date', 'target']) {
      const bad = structuredClone(backup);
      const decision = bad.external.find((r) => r.key === preview.id)!;
      const flow = bad.external.find((r) => r.key === 'workflow')!;
      if (corruption === 'owner') decision.namespace = 'planning:other:-';
      if (corruption === 'session') flow.value.sessionId = 'missing';
      if (corruption === 'proposal') flow.value.proposalIds = ['missing'];
      if (corruption === 'date') decision.value.after.date = '2026-10-20';
      if (corruption === 'target') decision.value.path.targets = ['made-up'];
      assert.throws(() => store.restore(bad));
      assert.equal(fingerprint(store.backup().tables), stable);
    }
    const old = structuredClone(backup);
    old.external = old.external.filter(
      (r) => !r.namespace.startsWith('planning:') && !r.namespace.startsWith('review-workflow:'),
    );
    for (let version = 1; version <= 10; version++) {
      store.restore({ ...old, version });
      assert.equal(planner.state().decisions.length, 0);
    }
  } finally {
    store.close();
  }
});
test('shared planning HTTP endpoints validate requests and expose no credentials', async () => {
  const { store } = setup();
  const { app } = await buildApp(store, undefined, { dev: true });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/planning/state' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().algorithm, 'budget-dp-1');
    const bad = await app.inject({
      method: 'POST',
      url: '/api/planning/preview',
      payload: { ...request, budget: -1 },
      headers: { 'x-review-app': '1' },
    });
    assert.equal(bad.statusCode, 400);
  } finally {
    await app.close();
    store.close();
  }
});
