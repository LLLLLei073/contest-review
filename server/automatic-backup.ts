import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Store } from './store.js';
import type { AutomaticBackupStatus } from '../shared/backup-status.js';

/** Device-local state is deliberately outside the learning database and its restore. */
export class AutomaticBackup {
  private enabled = true;
  private lastSuccess: string | null = null;
  private error: string | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  readonly directory: string;
  private readonly statePath: string;
  constructor(
    private store: Store,
    private busy: () => boolean,
    private now = () => new Date(),
  ) {
    this.directory = join(dirname(store.path), 'backups', 'automatic');
    this.statePath = join(this.directory, 'settings.json');
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (typeof saved.enabled === 'boolean') this.enabled = saved.enabled;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        this.error = '自动备份设置读取失败，请检查数据目录。';
    }
    this.refreshSuccess();
  }
  private files() {
    try {
      return readdirSync(this.directory)
        .filter((n) => /^automatic-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/.test(n))
        .sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }
  private refreshSuccess() {
    try {
      const latest = this.files().at(-1);
      if (latest)
        this.lastSuccess = latest.slice(10, -5).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
    } catch {
      this.error = '自动备份目录读取失败，请检查目录权限。';
    }
  }
  status(): AutomaticBackupStatus {
    return {
      supported: true,
      enabled: this.enabled,
      directory: this.directory,
      lastSuccess: this.lastSuccess,
      error: this.error,
    };
  }
  configure(enabled: boolean) {
    mkdirSync(this.directory, { recursive: true });
    const temporary = this.statePath + '.tmp';
    writeFileSync(temporary, JSON.stringify({ enabled }), 'utf8');
    renameSync(temporary, this.statePath);
    this.enabled = enabled;
    return this.status();
  }
  run(force = false) {
    if (this.stopped || (!force && !this.enabled)) return this.status();
    if (this.busy()) {
      if (force) throw new Error('请等待当前同步或比赛分析完成');
      return this.status();
    }
    const now = this.now();
    const localDate = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!force && !this.error && this.lastSuccess && localDate(new Date(this.lastSuccess)) === localDate(now))
      return this.status();
    let temporary = '';
    try {
      mkdirSync(this.directory, { recursive: true });
      const target = join(this.directory, 'automatic-' + now.toISOString().replace(/[:.]/g, '-') + '.json');
      temporary = target + '.tmp';
      // Synchronous snapshot + write cannot interleave with restore or other DB mutations.
      writeFileSync(temporary, JSON.stringify(this.store.backup()), { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, target);
      temporary = '';
      this.lastSuccess = now.toISOString();
      this.error = null;
      for (const name of this.files().slice(0, -7)) unlinkSync(join(this.directory, name));
    } catch (error) {
      this.error =
        String((error as NodeJS.ErrnoException).code ?? 'ERROR') +
        '：自动备份写入或轮换失败，请检查磁盘空间和目录权限；下次检查将重试。';
      if (temporary) {
        try {
          unlinkSync(temporary);
        } catch {
          /* preserve previous successful backups */
        }
      }
    }
    return this.status();
  }
  start() {
    this.run();
    this.timer = setInterval(() => this.run(), 3600000);
    this.timer.unref();
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }
}
