import { writeFileSync } from 'node:fs';
import { Store } from '../server/store.js';
import type { Catalog } from '../shared/training.js';

// Entirely synthetic, reproducible snapshot; never opens the user's database.
const store = new Store(':memory:');
const at = new Date('2026-10-14T04:00:00.000Z');
try {
  store.activate('synthetic_planner');
  store.enrich(
    'synthetic_planner',
    [],
    [],
    Array.from({ length: 20 }, (_, i) => ({
      contestId: 7000 + i,
      index: 'A',
      name: `Synthetic practice ${i}`,
      rating: 1100,
      tags: ['implementation'],
    })),
  );
  const catalog = store.get<Catalog>('catalog_cache', 'synthetic_planner', 'current')!;
  store.put('catalog_cache', 'synthetic_planner', 'current', { ...catalog, fetchedAt: at.toISOString() });
  store.saveWeeklyGoal({ mode: 'focus', categories: ['实现与模拟'] }, at);
  const backup = store.backup();
  backup.exportedAt = at.toISOString();
  writeFileSync('docs/verification/planner-synthetic-fixture.json', JSON.stringify(backup, null, 2) + '\n');
} finally {
  store.close();
}
