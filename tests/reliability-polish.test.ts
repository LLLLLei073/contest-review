import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { AutomaticBackup } from '../server/automatic-backup.js';
import { backupReminderDue } from '../shared/backup-status.js';
import { platformHealth } from '../shared/platform-health.js';
import { trainingContinuations } from '../shared/training-continuation.js';
import { AgentService } from '../shared/agent-service.js';
import type { AgentRecord } from '../shared/agent-domain.js';
import { ReviewWorkflowService } from '../shared/review-workflow.js';
import { backupSummary } from '../shared/backup-summary.js';
import { buildApp } from '../server/app.js';

test('XCPC interrupted update preserves its previous success and attempt time across restart', async () => {
  const store = new Store(':memory:');
  store.setSetting('xcpc-active', 'fixture-player');
  store.setSetting(
    'xcpc-health:fixture-player',
    JSON.stringify({
      status: 'running',
      lastSuccess: '2026-11-01T00:00:00Z',
      lastAttempt: '2026-11-02T00:00:00Z',
    }),
  );
  const { app } = await buildApp(store);
  try {
    const row = platformHealth(store).find((p) => p.id === 'xcpc')!;
    assert.equal(row.status, 'interrupted');
    assert.equal(row.lastSuccess, '2026-11-01T00:00:00Z');
    assert.equal(row.lastAttempt, '2026-11-02T00:00:00Z');
  } finally {
    await app.close();
    store.close();
  }
});

test('automatic backup deduplicates across restarts, defers busy work and rotates only its own files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-auto-'));
  const store = new Store(join(dir, 'review.sqlite'));
  let now = new Date('2026-11-03T02:00:00Z'),
    busy = true;
  try {
    store.activate('backup_test');
    let service = new AutomaticBackup(
      store,
      () => busy,
      () => now,
    );
    assert.equal(service.run().lastSuccess, null);
    busy = false;
    assert.equal(service.run().lastSuccess, now.toISOString());
    assert.equal(service.run().error, null);
    service = new AutomaticBackup(
      store,
      () => busy,
      () => now,
    );
    service.run();
    assert.equal(readdirSync(service.directory).filter((n) => n.startsWith('automatic-')).length, 1);
    writeFileSync(join(dir, 'backups', 'before-restore-keep.json'), '{}');
    writeFileSync(join(service.directory, 'unrelated.json'), '{}');
    for (let i = 0; i < 9; i++) {
      now = new Date(now.getTime() + 86400000);
      service.run();
    }
    assert.equal(readdirSync(service.directory).filter((n) => n.startsWith('automatic-')).length, 7);
    assert.ok(readdirSync(join(dir, 'backups')).includes('before-restore-keep.json'));
    assert.ok(readdirSync(service.directory).includes('unrelated.json'));
    const file = readdirSync(service.directory)
      .filter((n) => n.startsWith('automatic-'))
      .at(-1)!;
    const saved = JSON.parse(readFileSync(join(service.directory, file), 'utf8'));
    assert.equal(saved.version, 12);
    assert.deepEqual(backupSummary(saved).profiles, ['backup_test']);
    service.configure(false);
    store.restore(saved);
    const reopened = new AutomaticBackup(
      store,
      () => false,
      () => new Date(now.getTime() + 86400000),
    );
    assert.equal(reopened.status().enabled, false);
    assert.equal(reopened.run().lastSuccess, now.toISOString());
    reopened.stop();
    assert.equal(reopened.run(true).lastSuccess, now.toISOString());
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('failed backup does not record success and retries after path repair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-auto-fail-'));
  const store = new Store(join(dir, 'review.sqlite'));
  try {
    mkdirSync(join(dir, 'backups'));
    writeFileSync(join(dir, 'backups', 'automatic'), 'blocked');
    const service = new AutomaticBackup(store, () => false);
    assert.ok(service.run().error);
    assert.equal(service.status().lastSuccess, null);
    rmSync(join(dir, 'backups', 'automatic'));
    assert.equal(service.run().error, null);
    assert.ok(service.status().lastSuccess);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reminder distinguishes download requests and snooze expiry', () => {
  const now = Date.parse('2026-11-03T00:00:00Z');
  assert.equal(backupReminderDue(null, null, now), true);
  assert.equal(backupReminderDue('2026-11-01T00:00:00Z', null, now), false);
  assert.equal(backupReminderDue(null, '2026-11-10T00:00:00Z', now), false);
  assert.equal(backupReminderDue('2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z', now), true);
});

test('platform health preserves previous success on failure and reads without mutation', () => {
  const store = new Store(':memory:');
  try {
    store.activate('health_test');
    const job = { handle: 'health_test', mode: 'full', processed: 0, cursor: 0, message: 'ok' };
    store.put('jobs', 'health_test', 'one', {
      ...job,
      id: 'one',
      status: 'completed',
      startedAt: '2026-11-01T00:00:00Z',
      finishedAt: '2026-11-01T00:01:00Z',
    });
    store.put('jobs', 'health_test', 'two', {
      ...job,
      id: 'two',
      status: 'failed',
      message: 'offline',
      startedAt: '2026-11-02T00:00:00Z',
      finishedAt: '2026-11-02T00:01:00Z',
    });
    const rows = platformHealth(store);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].lastSuccess, '2026-11-01T00:01:00Z');
    assert.equal(rows[0].status, 'failed');
    assert.equal(rows[0].error, 'offline');
    assert.equal(rows[1].status, 'unbound');
    assert.equal(rows[3].capabilities.includes('不提供个人逐题提交'), true);
    assert.equal(store.dataHealth().cf.sync, rows[0].lastSuccess);
  } finally {
    store.close();
  }
});

test('continuation reads existing workflow, drops invalid context, completion and foreign accounts', async () => {
  const store = new Store(':memory:');
  try {
    store.activate('continue_test');
    const key = store.manualProblem('continue_test', {
      contestId: 9600,
      index: 'A',
      name: 'Resume me',
      rating: 1200,
      tags: [],
    });
    const agent = new AgentService(store);
    const session = (await agent.route('sessions', 'POST', {
      context: { kind: 'problem', problemKey: key },
    })) as Extract<AgentRecord, { kind: 'session' }>;
    const workflows = new ReviewWorkflowService(store);
    const workflow = workflows.start(session.id);
    const before = JSON.stringify(store.externalAll(workflows.scope()));
    const rows = trainingContinuations(store);
    assert.equal(rows[0].title, 'Resume me');
    assert.ok(rows[0].href.includes(encodeURIComponent(session.id)));
    assert.equal(JSON.stringify(store.externalAll(workflows.scope())), before);
    store.activate('other_user');
    assert.deepEqual(trainingContinuations(store), []);
    store.activate('continue_test');
    store.externalPut(workflows.scope(), workflow.id, { ...workflow, status: 'completed' });
    assert.deepEqual(trainingContinuations(store), []);
  } finally {
    store.close();
  }
});
