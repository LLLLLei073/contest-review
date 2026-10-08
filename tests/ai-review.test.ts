import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import {
  extractSubmissionCode,
  maskApiKey,
  parseAiReviewText,
  type AiReviewRecord,
  type FetchLike,
  type PageFetchLike,
} from '../shared/ai-review.js';
import type { CFClient } from '../server/sync.js';

const noopCf: CFClient = {
  async call<T>(): Promise<T> {
    return [] as T;
  },
};
const headers = { host: '127.0.0.1:3210', 'x-review-app': '1' };
const aiResult = {
  errorAnalysis: '循环下标越界，`a[i+1]` 在末尾出错',
  approachEvaluation: '整体贪心方向正确，但实现没有处理边界',
  counterexamples: ['输入：\n```\n1\n1\n```\n正确输出 1，代码输出 0'],
  knowledgePoints: ['边界处理', '贪心正确性证明'],
  suggestedReasons: ['边界遗漏'],
  suggestedCode: 'int main() { /* fixed */ return 0; }',
};
function fakeAi(responder: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>): {
  fetch: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetch: (async (url: string) => {
      calls.push(url);
      return responder();
    }) as FetchLike,
  };
}
const okResponder = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [{ message: { content: '```json\n' + JSON.stringify(aiResult) + '\n```' } }],
  }),
});
function setup(fetchImpl: FetchLike) {
  const s = new Store(':memory:');
  s.activate('tester');
  const key = s.manualProblem('tester', {
    contestId: 2000,
    index: 'B',
    name: 'Manual problem',
    tags: ['greedy'],
    rating: 1400,
  });
  return { s, key, appPromise: buildApp(s, noopCf, { aiFetch: fetchImpl }) };
}

test('parseAiReviewText tolerates fences and surrounding prose', () => {
  const plain = parseAiReviewText(JSON.stringify(aiResult));
  assert.equal(plain.knowledgePoints[0], '边界处理');
  const fenced = parseAiReviewText(
    '好的，分析如下：\n```json\n' + JSON.stringify(aiResult) + '\n```\n以上。',
  );
  assert.equal(fenced.suggestedReasons[0], '边界遗漏');
  assert.throws(() => parseAiReviewText('没有 JSON'), /格式异常/);
  assert.throws(() => parseAiReviewText('{"errorAnalysis":"只有部分字段"}'), /缺少必要字段/);
});

test('maskApiKey keeps both ends and hides the middle', () => {
  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey('sk-1234567890abcd'), 'sk-1…abcd');
  assert.equal(maskApiKey('short'), 'sh…');
});

test('AI review API: config lifecycle, masked key, review storage and errors', async () => {
  const { fetch, calls } = fakeAi(okResponder);
  const { s, key, appPromise } = setup(fetch);
  const { app } = await appPromise;
  const encoded = encodeURIComponent(key);

  const missing = await app.inject({
    method: 'POST',
    url: `/api/problems/${encoded}/ai-reviews`,
    headers,
    payload: { code: 'int main(){}', language: 'cpp' },
  });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.json().error, /配置 AI/);

  const saved = await app.inject({
    method: 'PUT',
    url: '/api/ai/settings',
    headers,
    payload: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890abcd', model: 'deepseek-chat' },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().configured, true);
  assert.equal(saved.json().apiKey, 'sk-1…abcd');

  const maskedRewrite = await app.inject({
    method: 'PUT',
    url: '/api/ai/settings',
    headers,
    payload: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-1…abcd', model: 'deepseek-chat' },
  });
  assert.equal(maskedRewrite.json().apiKey, 'sk-1…abcd');

  const review = await app.inject({
    method: 'POST',
    url: `/api/problems/${encoded}/ai-reviews`,
    headers,
    payload: {
      code: '#include <bits/stdc++.h>\nint main(){ return 0; }',
      language: 'cpp',
      verdict: 'WRONG_ANSWER',
    },
  });
  assert.equal(review.statusCode, 200);
  const record = review.json() as AiReviewRecord;
  assert.equal(record.problemKey, key);
  assert.equal(record.model, 'deepseek-chat');
  assert.equal(record.counterexamples.length, 1);
  assert.equal(record.suggestedCode, 'int main() { /* fixed */ return 0; }');
  assert.ok(calls[0].startsWith('https://api.deepseek.com/v1/chat/completions'));

  const list = await app.inject({ url: `/api/problems/${encoded}/ai-reviews`, headers });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].id, record.id);

  const backup = s.backup();
  assert.ok(
    backup.external!.some((row) => row.namespace === 'ai-review:tester'),
    'AI 复盘应随备份导出',
  );

  const removed = await app.inject({
    method: 'DELETE',
    url: `/api/problems/${encoded}/ai-reviews/${record.id}`,
    headers,
  });
  assert.equal(removed.statusCode, 200);
  assert.equal((await app.inject({ url: `/api/problems/${encoded}/ai-reviews`, headers })).json().length, 0);

  await app.close();
  s.close();
});

test('AI review API maps provider errors to Chinese messages', async () => {
  const { fetch } = fakeAi(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const { s, key, appPromise } = setup(fetch);
  const { app } = await appPromise;
  await app.inject({
    method: 'PUT',
    url: '/api/ai/settings',
    headers,
    payload: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'bad-key', model: 'deepseek-chat' },
  });
  const denied = await app.inject({
    method: 'POST',
    url: `/api/problems/${encodeURIComponent(key)}/ai-reviews`,
    headers,
    payload: { code: 'int main(){}', language: 'cpp' },
  });
  assert.equal(denied.statusCode, 400);
  assert.match(denied.json().error, /密钥无效/);
  await app.close();
  s.close();
});

test('extractSubmissionCode handles AtCoder and Codeforces markup', () => {
  const atcoder = `<html><body><pre id="submission-code" data-ace-mode="c_cpp">#include &lt;bits/stdc++.h&gt;
using namespace std;
int main() { cout &lt;&lt; &quot;hi&quot; &lt;&lt; &#39;!&#39;; }
</pre></body></html>`;
  assert.equal(
    extractSubmissionCode(atcoder),
    '#include <bits/stdc++.h>\nusing namespace std;\nint main() { cout << "hi" << \'!\'; }',
  );
  const cf = `<pre id="program-source-text" class="prettyprint lang-cpp">int main() { return 0; }</pre>`;
  assert.equal(extractSubmissionCode(cf), 'int main() { return 0; }');
  assert.throws(() => extractSubmissionCode('<html>no code</html>'), /未找到源码/);
});

test('old AI review results without suggestedCode still parse', () => {
  const legacy: Record<string, unknown> = { ...aiResult };
  delete legacy.suggestedCode;
  const parsed = parseAiReviewText(JSON.stringify(legacy));
  assert.equal(parsed.suggestedCode, '');
});

test('fetch-submission-code route extracts code and degrades gracefully', async () => {
  const s = new Store(':memory:');
  s.activate('tester');
  s.ingest('tester', [
    {
      id: 42,
      contestId: 2000,
      creationTimeSeconds: 1700000000,
      problem: { contestId: 2000, index: 'B', name: 'Manual problem', tags: ['greedy'] },
      verdict: 'WRONG_ANSWER',
      programmingLanguage: 'GNU C++20',
      author: { participantType: 'CONTESTANT' },
    },
  ]);
  const pageFetch = (async (url: string) => {
    assert.ok(url.includes('codeforces.com/contest/2000/submission/42'));
    return {
      ok: true,
      status: 200,
      text: async () => '<pre id="program-source-text">int main() { /* bug */ }</pre>',
    };
  }) as unknown as PageFetchLike;
  const { app } = await buildApp(s, noopCf, {
    aiFetch: fakeAi(okResponder).fetch,
    pageFetch,
  });
  const fetched = await app.inject({
    method: 'POST',
    url: '/api/problems/2000%3AB/fetch-submission-code',
    headers,
    payload: { submissionId: 42 },
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().code, 'int main() { /* bug */ }');
  assert.equal(fetched.json().language, 'cpp');

  const wrongId = await app.inject({
    method: 'POST',
    url: '/api/problems/2000%3AB/fetch-submission-code',
    headers,
    payload: { submissionId: 999 },
  });
  assert.equal(wrongId.statusCode, 400);
  assert.match(wrongId.json().error, /不属于此题目/);
  await app.close();
  s.close();

  const s2 = new Store(':memory:');
  s2.activate('tester');
  s2.ingest('tester', [
    {
      id: 43,
      contestId: 2000,
      creationTimeSeconds: 1700000000,
      problem: { contestId: 2000, index: 'B', name: 'Manual problem', tags: ['greedy'] },
      verdict: 'WRONG_ANSWER',
      programmingLanguage: 'GNU C++20',
      author: { participantType: 'CONTESTANT' },
    },
  ]);
  const blocked = await buildApp(s2, noopCf, {
    pageFetch: (async () => ({ ok: false, status: 403, text: async () => '' })) as PageFetchLike,
  });
  const denied = await blocked.app.inject({
    method: 'POST',
    url: '/api/problems/2000%3AB/fetch-submission-code',
    headers,
    payload: { submissionId: 43 },
  });
  assert.equal(denied.statusCode, 400);
  assert.match(denied.json().error, /手动复制代码/);
  assert.match(denied.json().error, /codeforces\.com/);
  await blocked.app.close();
  s2.close();
});
