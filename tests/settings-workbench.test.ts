import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store';
import { buildApp } from '../server/app';
import { backupSummary } from '../shared/backup-summary';
import { resolveAiConfiguration } from '../shared/ai-configuration';
import { maskApiKey } from '../shared/ai-review';
test('backup inventory is read-only and does not reveal credentials', () => {
  const s = new Store(':memory:');
  try {
    s.activate('owner');
    s.externalPut('ai', 'config', { apiKey: 'secret' });
    const b = s.backup(),
      summary = backupSummary(b);
    assert.equal(summary.version, 12);
    assert.deepEqual(summary.profiles, ['owner']);
    assert.ok(!JSON.stringify(summary).includes('secret'));
    for (let version = 1; version <= 12; version++)
      assert.equal(backupSummary({ ...b, version }).version, version);
    assert.throws(() => backupSummary({ ...b, version: 99 }));
    assert.deepEqual(s.backup().tables, b.tables);
  } finally {
    s.close();
  }
});
test('testing a draft model configuration never saves it and masked credentials cannot cross hosts', async () => {
  const s = new Store(':memory:');
  const saved = { baseUrl: 'https://saved.invalid/v1', apiKey: 'sk-original-secret-123456', model: 'old' };
  s.externalPut('ai', 'config', saved);
  const urls: string[] = [];
  const { app } = await buildApp(s, undefined, {
    aiFetch: async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '连接成功' } }] }),
      };
    },
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/test',
      headers: { 'x-review-app': '1' },
      payload: { baseUrl: 'https://draft.invalid/v1', apiKey: 'draft-key', model: 'draft' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(urls[0], 'https://draft.invalid/v1/chat/completions');
    assert.deepEqual(s.externalGet('ai', 'config'), saved);
    const rejected = await app.inject({
      method: 'PUT',
      url: '/api/ai/settings',
      headers: { 'x-review-app': '1' },
      payload: { ...saved, baseUrl: 'https://other.invalid/v1', apiKey: maskApiKey(saved.apiKey) },
    });
    assert.equal(rejected.statusCode, 400);
    assert.deepEqual(s.externalGet('ai', 'config'), saved);
    assert.throws(
      () =>
        resolveAiConfiguration(
          { ...saved, baseUrl: 'https://other.invalid/v1', apiKey: maskApiKey(saved.apiKey) },
          saved,
        ),
      /重新填写/,
    );
    assert.equal(
      resolveAiConfiguration({ ...saved, apiKey: maskApiKey(saved.apiKey) }, saved).apiKey,
      saved.apiKey,
    );
  } finally {
    await app.close();
    s.close();
  }
});
