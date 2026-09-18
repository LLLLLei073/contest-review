import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CoreStore } from '../shared/core-store.js';
export {
  submissionSchema,
  contestReviewSchema,
  jobSchema,
  problemKey,
  localDay,
} from '../shared/core-store.js';
export class Store extends CoreStore {
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    super(new DatabaseSync(path), (backup) => {
      if (path === ':memory:') return null;
      const dir = join(dirname(path), 'backups');
      mkdirSync(dir, { recursive: true });
      const backupPath = join(
        dir,
        'before-restore-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.json',
      );
      writeFileSync(backupPath, JSON.stringify(backup), 'utf8');
      return backupPath;
    });
  }
}
