import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import {
  LuoguService,
  luoguProfile,
  luoguNamespace,
  luoguVerdict,
  luoguRating,
  normalizeLuogu,
  luoguUidSchema,
  type LuoguClientLike,
  type LuoguRecord,
  type LuoguUser,
} from '../shared/luogu.js';
import { buildInsights } from '../shared/insights.js';

const midday = new Date();
midday.setHours(12, 0, 0, 0);
const sec = Math.floor(midday.getTime() / 1000);
const record = (id: number, pid: string, status: number, difficulty: number, time = sec): LuoguRecord => ({
  id,
  time,
  status,
  language: 'cpp',
  problem: { pid, title: `${pid} 题`, difficulty },
});
const user: LuoguUser = {
  uid: 109757,
  name: '回用户',
  passedProblemCount: 42,
  submittedProblemCount: 100,
};
class FakeLuogu implements LuoguClientLike {
  pages: LuoguRecord[][] = [];
  failPage = -1;
  userCalls = 0;
  cancel() {}
  async user(uid: string): Promise<LuoguUser> {
    this.userCalls++;
    if (!/^\d+$/.test(uid)) throw new Error('洛谷用户不存在');
    return user;
  }
  async records(_uid: string, page: number) {
    if (page === this.failPage) throw new Error('fixture outage');
    const items = this.pages[page - 1] ?? [];
    return { count: this.pages.flat().length, perPage: 2, result: items };
  }
}
function setup() {
  const store = new Store(':memory:');
  store.activate('cfuser');
  const client = new FakeLuogu();
  const service = new LuoguService(store, client);
  return { store, client, service };
}

test('洛谷 UID 校验、状态与难度映射、毫秒时间戳归一', () => {
  assert.equal(luoguUidSchema.parse(' 109757 '), '109757');
  assert.throws(() => luoguUidSchema.parse('abc'));
  assert.equal(luoguVerdict(12), 'OK');
  assert.equal(luoguVerdict(6), 'WRONG_ANSWER');
  assert.equal(luoguVerdict(5), 'TIME_LIMIT_EXCEEDED');
  assert.equal(luoguVerdict(11), 'PARTIAL');
  assert.equal(luoguRating(4), 1500);
  assert.equal(luoguRating(0), undefined);
  const normalized = normalizeLuogu(record(9, 'P1001', 12, 2, sec * 1000));
  assert.equal(normalized.source, 'luogu');
  assert.equal(normalized.creationTimeSeconds, sec);
  assert.equal(normalized.problem.index, 'P1001');
  assert.equal(normalized.problem.rating, 1000);
  assert.equal(normalized.verdict, 'OK');
});

test('洛谷绑定写入用户快照并激活独立分区', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  assert.ok(client.userCalls >= 1);
  assert.equal(store.activeLuogu(), '109757');
  assert.deepEqual(store.luoguUsers(), ['109757']);
  const snapshot = store.externalGet<{ name: string; passedProblemCount: number }>(
    luoguNamespace('109757'),
    'user',
  );
  assert.equal(snapshot?.name, '回用户');
  assert.equal(snapshot?.passedProblemCount, 42);
  // lg~ 分区不会混入 CF 用户名列表
  assert.deepEqual(store.handles(), ['cfuser']);
  store.close();
});

test('洛谷全量同步翻页直到空页，失败提交自动进入复习', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.pages = [
    [record(31, 'P1003', 12, 5), record(30, 'P1002', 6, 3)],
    [record(29, 'P1001', 12, 1)],
    [],
  ];
  const job = service.start('109757', 'full');
  await service.running;
  const profile = luoguProfile('109757');
  assert.equal(job.status, 'completed');
  assert.equal(store.all('submissions', profile).length, 3);
  // 原始题目表保存全部三题；错题库视图只含失败过的 P1002
  assert.equal(store.all('problems', profile).length, 3);
  assert.equal(store.problems(profile).length, 1);
  assert.equal(store.problems(profile)[0].source, 'luogu');
  assert.ok(
    store
      .all<{ url: string }>('problems', profile)
      .every((p) => p.url.startsWith('https://www.luogu.com.cn/problem/')),
  );
  // WA 的 P1002 应有自动复习记录，AC 的没有
  assert.ok(store.get('reviews', profile, 'luogu:P1002'));
  assert.ok(!store.get('reviews', profile, 'luogu:P1001'));
  assert.equal(store.problems('cfuser').length, 0);
  store.close();
});

test('洛谷增量同步在已见记录处截停', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.pages = [[record(20, 'P1001', 12, 1), record(19, 'P2000', 12, 2)], []];
  service.start('109757', 'incremental');
  await service.running;
  // 新一页：新提交 21 + 已见提交 20（应停止，不再读第二页）
  client.pages = [[record(21, 'P3000', 12, 3), record(20, 'P1001', 12, 1)]];
  const job = service.start('109757', 'incremental');
  await service.running;
  assert.equal(job.status, 'completed');
  assert.equal(job.processed, 1);
  assert.equal(store.all('submissions', luoguProfile('109757')).length, 3);
  store.close();
});

test('洛谷同步失败写入可读错误信息', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.failPage = 1;
  const job = service.start('109757', 'full');
  await service.running;
  assert.equal(job.status, 'failed');
  assert.equal(job.message, 'fixture outage');
  store.close();
});

test('combinedStatistics 纳入洛谷并支持单独来源', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.pages = [[record(30, 'P1002', 6, 3), record(29, 'P1001', 12, 1)], []];
  service.start('109757', 'incremental');
  await service.running;
  const only = store.combinedStatistics('luogu');
  // 统计视图是错题库口径：只有失败进入复习的 P1002 计入 total/unsolved
  assert.equal(only.total, 1);
  assert.equal(only.unsolved, 1);
  assert.ok(only.submissions >= 2);
  const all = store.combinedStatistics('all');
  assert.equal(all.total, 1);
  const cf = store.combinedStatistics('cf');
  assert.equal(cf.total, 0);
  store.close();
});

test('buildInsights 汇总账号、指标、难度分布与活跃月份', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.pages = [[record(30, 'P1002', 6, 3), record(29, 'P1001', 12, 1)], []];
  service.start('109757', 'incremental');
  await service.running;
  const payload = buildInsights(store, midday);
  assert.equal(payload.accounts.length, 3);
  assert.deepEqual(
    payload.accounts.map((a) => a.platform),
    ['cf', 'atcoder', 'luogu'],
  );
  const luogu = payload.accounts[2];
  assert.equal(luogu.bound, true);
  assert.equal(luogu.officialSolved, 42);
  assert.equal(luogu.solved, 1);
  assert.equal(luogu.submissions, 2);
  assert.ok(luogu.lastSync);
  assert.equal(payload.accounts[0].bound, true);
  assert.equal(payload.accounts[1].bound, false);
  assert.equal(payload.totals.solved, 1);
  assert.equal(payload.totals.submissions, 2);
  assert.equal(payload.totals.activeDays, 1);
  // P1001(入门→800) 已通过落入 ≤999 桶；P1002(普及/提高−→1200) WA 不计入已通过分布
  const easy = payload.difficulty.find((d) => d.label === '≤999');
  assert.equal(easy?.luogu, 1);
  assert.equal(payload.difficulty.reduce((n, d) => n + d.luogu, 0), 1);
  assert.equal(payload.activity.length, 12);
  const currentMonth = payload.activity.at(-1)!;
  assert.equal(currentMonth.luogu, 2);
  assert.equal(currentMonth.cf, 0);
  // 雷达：每个视图都是 8 个维度
  for (const view of ['all', 'cf', 'atcoder', 'luogu'] as const) {
    assert.equal(payload.mastery[view].length, 8);
    assert.ok(payload.mastery[view].every((a) => Number.isFinite(a.score)));
  }
  store.close();
});

test('洛谷备份与恢复往返保留分区与激活状态', async () => {
  const { store, client, service } = setup();
  await service.bind('109757');
  client.pages = [[record(30, 'P1002', 6, 3)], []];
  service.start('109757', 'incremental');
  await service.running;
  const backup = store.backup();
  assert.ok(backup.profiles.includes('lg~109757'));
  store.restore(backup);
  assert.equal(store.activeLuogu(), '109757');
  assert.equal(store.all('submissions', luoguProfile('109757')).length, 1);
  assert.deepEqual(store.handles(), ['cfuser']);
  store.close();
});
