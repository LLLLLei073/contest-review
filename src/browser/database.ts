import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { CoreStore, type DatabaseLike, type SQLValue } from '../../shared/core-store';
import { CodeforcesClient, SyncService } from '../../shared/sync';
import { AnalysisService } from '../../shared/analysis-service';
import { ContestHub } from '../../shared/contest-hub';
import { TrainingService } from '../../shared/training-service';
import { AtcoderService, AtcoderClient } from '../../shared/atcoder';

class BrowserSQLite implements DatabaseLike {
  constructor(public raw: Database) {}
  exec(sql: string) {
    this.raw.run(sql);
  }
  close() {
    this.raw.close();
  }
  prepare(sql: string) {
    const query = (params: SQLValue[], single: boolean) => {
      const statement = this.raw.prepare(sql);
      try {
        statement.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject());
          if (single) break;
        }
        return rows;
      } finally {
        statement.free();
      }
    };
    return {
      get: (...params: SQLValue[]) => query(params, true)[0],
      all: (...params: SQLValue[]) => query(params, false),
      run: (...params: SQLValue[]) => this.raw.run(sql, params),
    };
  }
  export() {
    const bytes = this.raw.export();
    this.raw.run('PRAGMA foreign_keys=ON');
    return bytes;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('contest-review-' + import.meta.env.BASE_URL, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开浏览器存储，请确认没有禁止站点存储。'));
    request.onblocked = () => reject(new Error('数据库升级被其他页面阻塞，请关闭其他页面后重试。'));
  });
}
function read<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function lockDatabase() {
  if (!navigator.locks) throw new Error('请使用支持 Web Locks 的现代浏览器，并通过 HTTPS 打开此页面。');
  await new Promise<void>((resolve, reject) => {
    navigator.locks
      .request('contest-review-writer-' + import.meta.env.BASE_URL, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error('另一个标签页正在使用此错题库。请关闭它，再刷新当前页面。'));
          return;
        }
        resolve();
        await new Promise<void>((release) =>
          window.addEventListener('pagehide', () => release(), { once: true }),
        );
      })
      .catch(reject);
  });
}

export class BrowserRuntime {
  readonly store: CoreStore;
  readonly cf = new CodeforcesClient((url, options) => fetch(url, { ...options, credentials: 'omit' }));
  readonly sync: SyncService;
  readonly analysis: AnalysisService;
  readonly hub: ContestHub;
  readonly training: TrainingService;
  readonly atcoder: AtcoderService;
  private writes: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private previous: unknown;
  private storageError = '';
  constructor(
    private db: IDBDatabase,
    private sqlite: BrowserSQLite,
  ) {
    this.store = new CoreStore(sqlite, (backup) => {
      this.previous = backup;
      return '当前浏览器，可下载恢复前备份';
    });
    this.sync = new SyncService(this.store, this.cf, 1000, () => this.flush());
    this.analysis = new AnalysisService(this.store, this.cf, () => this.flush());
    this.atcoder = new AtcoderService(
      this.store,
      new AtcoderClient(
        (url, options) => fetch(url, { ...options, credentials: 'omit' }),
        1200,
        import.meta.env.MODE === 'pages' ? `${import.meta.env.BASE_URL}atcoder-resources/` : undefined,
      ),
      () => this.flush(),
    );
    this.hub = new ContestHub(
      this.store,
      this.sync,
      this.analysis,
      () => this.flush(),
      undefined,
      this.atcoder,
    );
    this.training = new TrainingService(this.store, this.cf, () => this.flush());
    window.addEventListener('beforeunload', (event) => {
      if (
        this.pendingWrites ||
        this.sync.running ||
        this.analysis.running ||
        this.hub.isBusy() ||
        this.atcoder.running
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) location.reload();
    });
  }
  assertWritable() {
    if (this.storageError) throw new Error(this.storageError);
  }
  async previousBackup() {
    return read<unknown>(this.db, 'before-restore');
  }
  async flush() {
    this.assertWritable();
    const bytes = this.sqlite.export(),
      previous = this.previous;
    this.previous = undefined;
    this.pendingWrites++;
    this.writes = this.writes.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const transaction = this.db.transaction('files', 'readwrite');
          transaction.objectStore('files').put(bytes, 'database');
          if (previous !== undefined) transaction.objectStore('files').put(previous, 'before-restore');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error || new Error('浏览器写入已取消'));
          transaction.onerror = () => {};
        }),
    );
    try {
      await this.writes;
    } catch (error) {
      this.storageError = '浏览器存储写入失败，已停止后续写入。请立即导出备份，释放空间后重新打开页面。';
      this.sync.stop();
      this.atcoder.stop();
      throw new Error(this.storageError, { cause: error });
    } finally {
      this.pendingWrites--;
    }
  }
}
let runtime: Promise<BrowserRuntime> | undefined;
export function browserRuntime() {
  return (runtime ??= (async () => {
    await lockDatabase();
    const db = await openDatabase();
    const [SQL, bytes] = await Promise.all([
      initSqlJs({ locateFile: () => wasmUrl }),
      read<Uint8Array>(db, 'database'),
    ]);
    const instance = new BrowserRuntime(db, new BrowserSQLite(new SQL.Database(bytes)));
    await instance.flush();
    return instance;
  })());
}
