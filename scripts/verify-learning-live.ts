// Read the configured credentials without printing them; all generated test data lives in memory.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { LearningService } from '../shared/learning-service.js';
import { aiConfigSchema } from '../shared/ai-review.js';
import type { ExperienceCard, LearningRecord } from '../shared/learning-domain.js';

const file = resolve(process.argv[2] || 'data/review.sqlite');
if (!existsSync(file)) {
  console.log('UNAVAILABLE: no local AI configuration database');
  process.exit(0);
}
const db = new DatabaseSync(file, { readOnly: true });
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='external'").get()) {
  db.close();
  console.log('UNAVAILABLE: local database has no AI configuration table');
  process.exit(0);
}
const row = db.prepare("SELECT value FROM external WHERE namespace='ai' AND key='config'").get() as
  { value: string } | undefined;
db.close();
const config = row ? aiConfigSchema.safeParse(JSON.parse(row.value)) : null;
if (!config?.success) {
  console.log('UNAVAILABLE: no saved compatible AI configuration');
  process.exit(0);
}
const store = new Store(':memory:');
store.activate('learning_acceptance');
store.externalPut('ai', 'config', config.data);
const key = store.manualProblem('learning_acceptance', {
  contestId: 2000,
  index: 'A',
  name: '二分边界练习',
  rating: 1000,
  tags: ['binary search'],
});
store.saveReview('learning_acceptance', key, {
  ...store.review('learning_acceptance', key),
  rootCause: '右端点处理错误',
  solution: '证明单调性并维护区间不变量',
});
store.enrich(
  'learning_acceptance',
  [],
  [],
  Array.from({ length: 25 }, (_, i) => ({
    contestId: 3000 + i,
    index: 'A',
    name: 'Boundary Practice ' + i,
    rating: 1100 + (i % 3) * 100,
    tags: ['binary search'],
  })),
);
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
store.saveWeeklyGoal({ mode: 'focus', categories: ['数据结构'] }, tomorrow);
const learning = new LearningService(store);
try {
  const card = (await learning.draft({ problemKey: key })) as ExperienceCard;
  await learning.editCard({ ...card, confirmed: true });
  console.log('RUNNING: real model RAG');
  await learning.ask({ question: '结合我的复盘，如何避免二分边界错误？' });
  console.log('PASSED: real model RAG and citation validation');
  console.log('RUNNING: real model hint');
  await learning.hint({
    problemKey: key,
    statement: '输入有序数组 a 和整数 x，输出第一个大于等于 x 的元素下标，不存在时输出 n。',
    idea: '用二分找位置',
    level: 1,
  });
  console.log('PASSED: real model progressive hint');
  console.log('RUNNING: real model diagnosis');
  await learning.diagnose({ period: 'all' });
  console.log('PASSED: real model evidence diagnosis');
  console.log('RUNNING: real model training agent');
  const revision = (await learning.agent({ automatic: false })) as LearningRecord & { fallback?: boolean };
  if (revision.fallback) throw new Error('Real Agent rejected model selection; rule fallback retained');
  console.log('PASSED: real model next-day Agent');
  console.log('RUNNING: real model stress bundle');
  await learning.bundle({
    problemKey: key,
    code: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<n;}',
    language: 'cpp',
    statement: '输入整数 n（1<=n<=10），输出 2*n。',
  });
  console.log('PASSED: real model stress bundle generation');
} catch (error) {
  console.error('FAILED:', (error as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
