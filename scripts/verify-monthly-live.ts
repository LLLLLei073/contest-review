// Read credentials from the local database; send only synthetic training records to the model.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../server/store.js';
import { aiConfigSchema } from '../shared/ai-review.js';
import { LearningService } from '../shared/learning-service.js';
import { monthlyReport } from '../shared/monthly-report.js';

const file = resolve(process.argv[2] || 'data/review.sqlite');
if (!existsSync(file)) {
  console.log('UNAVAILABLE: no local AI configuration database');
  process.exit(0);
}
const db = new DatabaseSync(file, { readOnly: true });
if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='external'").get()) {
  db.close();
  console.log('UNAVAILABLE: no saved AI configuration table');
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
store.activate('monthly_acceptance');
store.externalPut('ai', 'config', config.data);
store.ingest('monthly_acceptance', [
  {
    id: 1,
    contestId: 2000,
    creationTimeSeconds: Math.floor(Date.now() / 1000) - 60,
    problem: { contestId: 2000, index: 'A', name: 'Synthetic DP exercise', tags: ['dp'] },
    verdict: 'WRONG_ANSWER',
    programmingLanguage: 'C++',
    author: { participantType: 'PRACTICE' },
  },
]);
try {
  const r = monthlyReport(store);
  const result = await new LearningService(store).monthly({ month: r.month, fingerprint: r.fingerprint });
  console.log(
    `PASSED: real monthly AI interpretation, ${result.findings.length} findings with validated evidence`,
  );
} catch (error) {
  console.error('FAILED:', (error as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
