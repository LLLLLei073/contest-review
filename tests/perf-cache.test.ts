import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildInsights } from '../shared/insights.js';
import type { CFSubmission } from '../shared/domain.js';

const midday = new Date();
midday.setHours(12, 0, 0, 0);
const sec = Math.floor(midday.getTime() / 1000);
const submission = (id: number, verdict = 'OK'): CFSubmission => ({
  id,
  contestId: 6100,
  creationTimeSeconds: sec - 3600 + id,
  problem: { contestId: 6100, index: 'A', name: 'Cache ' + id, rating: 1200, tags: ['dp'] },
  verdict,
  programmingLanguage: 'C++',
  author: { participantType: 'CONTESTANT', members: [{ handle: 'cache_test' }] },
});
function setup() {
  const store = new Store(':memory:');
  store.activate('cache_test');
  store.enrich(
    'cache_test',
    [],
    [],
    Array.from({ length: 6 }, (_, i) => ({
      contestId: 6100,
      index: String.fromCharCode(65 + i),
      name: 'P' + i,
      rating: 1200,
      tags: ['dp'],
    })),
  );
  store.ingest('cache_test', [submission(1), submission(2, 'WRONG_ANSWER')]);
  return store;
}

test('derived reads reuse one result within the same write epoch', () => {
  const store = setup(),
    h = 'cache_test';
  try {
    assert.equal(store.problems(h), store.problems(h));
    assert.equal(store.contests(h), store.contests(h));
    assert.equal(store.analysis(h, 6100), store.analysis(h, 6100));
    const now = new Date(midday);
    assert.equal(store.combinedStatistics('all', now), store.combinedStatistics('all', now));
    assert.equal(buildInsights(store, now), buildInsights(store, now));
    // combinedTrainingDay 内部的两次 combinedStatistics 也应命中同一缓存
    store.combinedTrainingDay(now);
    assert.ok(store.writeEpoch > 0);
  } finally {
    store.close();
  }
});

test('table writes invalidate every derived cache', () => {
  const store = setup(),
    h = 'cache_test';
  try {
    const before = {
      problems: store.problems(h),
      contests: store.contests(h),
      analysis: store.analysis(h, 6100),
      stats: store.combinedStatistics('all', new Date(midday)),
      insights: buildInsights(store, new Date(midday)),
    };
    // 新提交：题目聚合、比赛行、统计、汇总全部随之变化
    store.ingest(h, [submission(50, 'WRONG_ANSWER')]);
    const after = {
      problems: store.problems(h),
      contests: store.contests(h),
      analysis: store.analysis(h, 6100),
      stats: store.combinedStatistics('all', new Date(midday)),
      insights: buildInsights(store, new Date(midday)),
    };
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      assert.notEqual(before[key], after[key], key + ' 应在写入后重算');
      assert.equal(after[key], after[key], key + ' 重算后再次读取应命中新缓存');
    }
    assert.ok(after.problems.some((p) => p.key === '6100:A'));
    assert.equal(after.stats.submissions, 3);
  } finally {
    store.close();
  }
});

test('external writes and review updates invalidate statistics', () => {
  const store = setup(),
    h = 'cache_test',
    now = new Date(midday);
  try {
    const first = store.combinedStatistics('all', now);
    // external 写入（外部命名空间）通过 externalPut 失效
    store.externalPut('reason:' + h, 'snapshot-1', { id: 'snapshot-1', problemKey: '6100:A' });
    assert.notEqual(store.combinedStatistics('all', now), first);
    // 复习写入通过 put 失效
    const second = store.combinedStatistics('all', now);
    store.saveReview(h, '6100:A', {
      ...store.review(h, '6100:A'),
      status: 'reviewing',
      nextReview: new Date(sec * 1000 + 86400000).toISOString(),
    });
    const third = store.combinedStatistics('all', now);
    assert.notEqual(third, second);
    assert.equal(third, store.combinedStatistics('all', now));
  } finally {
    store.close();
  }
});

test('account switch, restore and day rollover invalidate caches', () => {
  const store = setup(),
    h = 'cache_test',
    now = new Date(midday);
  try {
    const asIs = store.combinedStatistics('all', now);
    // 切换账号：activate 的裸 SQL 也必须失效（否则拿到旧账号的合计）
    store.activate('someone_else');
    const switched = store.combinedStatistics('all', now);
    assert.notEqual(switched, asIs);
    assert.equal(switched.total, 0);
    store.activate(h);
    assert.equal(store.combinedStatistics('all', now).total, 1);
    // 恢复备份：整库替换后全部失效
    const backup = store.backup();
    const beforeRestore = store.problems(h);
    store.restore(backup);
    assert.notEqual(store.problems(h), beforeRestore);
    assert.equal(store.problems(h), store.problems(h));
    // 日期翻转：同数据不同天应重算（键含自然日）
    const day1 = store.combinedStatistics('all', now);
    const day2 = store.combinedStatistics('all', new Date(midday.getTime() + 86400000));
    assert.notEqual(day1, day2);
  } finally {
    store.close();
  }
});
