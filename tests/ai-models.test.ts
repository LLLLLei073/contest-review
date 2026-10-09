import test from 'node:test';
import assert from 'node:assert/strict';
import { listAiModels } from '../shared/ai-models.js';
import { maskApiKey, type FetchLike } from '../shared/ai-review.js';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
const input = { baseUrl: 'https://models.test/v1/', apiKey: 'fixture-secret-key' };
const response: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }, { id: '' }, { id: 42 }, null] }),
});
test('model discovery uses Base URL, bearer auth, timeout and normalizes model IDs', async () => {
  const result = await listAiModels(input, null, async (url, init) => {
    assert.equal(url, 'https://models.test/v1/models');
    const request = init as RequestInit;
    assert.equal(request.method, 'GET');
    assert.deepEqual(request.headers, { Authorization: 'Bearer fixture-secret-key' });
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal);
    return response(url, init);
  });
  assert.deepEqual(result.models, ['a', 'z']);
});
test('masked saved key is reused only for its saved address, and local service permits no key', async () => {
  const saved = { ...input, model: 'existing' };
  await listAiModels({ ...input, apiKey: maskApiKey(input.apiKey) }, saved, async (url, init) => {
    assert.deepEqual((init as RequestInit).headers, { Authorization: 'Bearer fixture-secret-key' });
    return response(url, init);
  });
  await assert.rejects(
    listAiModels({ baseUrl: 'https://other.test/v1', apiKey: maskApiKey(input.apiKey) }, saved, response),
    /重新填写/,
  );
  await listAiModels({ ...input, apiKey: '' }, null, async (url, init) => {
    assert.deepEqual((init as RequestInit).headers, {});
    return response(url, init);
  });
});
test('discovery reports authentication, unsupported format, empty lists and network failures safely', async () => {
  for (const status of [401, 403, 404, 429])
    await assert.rejects(
      listAiModels(input, null, async () => ({
        ok: false,
        status,
        json: async () => ({ error: input.apiKey }),
      })),
      status === 401 || status === 403 ? /密钥/ : status === 429 ? /频繁/ : /404/,
    );
  await assert.rejects(
    listAiModels(input, null, async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) })),
    /兼容模型列表/,
  );
  assert.deepEqual(
    await listAiModels(input, null, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })),
    { models: [] },
  );
  await assert.rejects(
    listAiModels(input, null, async () => {
      throw new TypeError(input.apiKey);
    }),
    /无法连接/,
  );
  await assert.rejects(
    listAiModels(input, null, async () => {
      throw new DOMException('timeout', 'TimeoutError');
    }),
    /超时/,
  );
});
test('models API accepts unsaved credentials without storing or changing AI config', async () => {
  const store = new Store(':memory:');
  const { app } = await buildApp(
    store,
    {
      async call<T>() {
        return [] as T;
      },
    },
    { aiFetch: response },
  );
  try {
    const headers = { host: '127.0.0.1:3210', 'x-review-app': '1' };
    const result = await app.inject({ method: 'POST', url: '/api/ai/models', headers, payload: input });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.json(), { models: ['a', 'z'] });
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/ai/settings', headers })).json().configured,
      false,
    );
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/ai/models',
      headers,
      payload: { baseUrl: 'not-url', apiKey: '' },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
    store.close();
  }
});
