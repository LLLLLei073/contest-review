import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildInsights } from '../shared/insights.js';

// 回归：数据总览的 CF「当前 Rating」曾取 contests 列表的末条，而该列表按开赛
// 时间从新到旧排序，实际取到的是最老一场的评级而不是最新评级。
test('数据总览的 CF 当前 Rating 取最新一场评级，而不是列表末条', () => {
  const store = new Store(':memory:');
  store.activate('rating_user');
  const contests = [
    { id: 2173, name: 'Old Round', startTimeSeconds: 1000, type: 'CF' as const },
    { id: 2277, name: 'New Round', startTimeSeconds: 5000, type: 'CF' as const },
  ];
  // 故意把最老的评级变更放在列表末尾：CF 接口的返回顺序不保证按时间排。
  const ratings = [
    {
      contestId: 2277,
      contestName: 'New Round',
      oldRating: 700,
      newRating: 1100,
      rank: 1200,
      ratingUpdateTimeSeconds: 5000,
    },
    {
      contestId: 2173,
      contestName: 'Old Round',
      oldRating: 0,
      newRating: 700,
      rank: 1800,
      ratingUpdateTimeSeconds: 1000,
    },
  ];
  store.enrich('rating_user', contests, ratings, []);
  const payload = buildInsights(store, new Date());
  const cf = payload.accounts.find((a) => a.platform === 'cf');
  assert.equal(cf?.rating, 1100);
  // 与趋势图的最后一个点一致
  assert.equal(payload.ratings.cf.at(-1)?.rating, 1100);
  store.close();
});
