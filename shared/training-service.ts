import type { CFSubmission } from './domain.js';
import type { CoreStore } from './core-store.js';
import type { CFClient } from './sync.js';

export class TrainingService {
  private running = new Map<string, Promise<{ checkedAt: string | null; error: string | null }>>();
  constructor(private store: CoreStore, private cf: CFClient, private persist: () => Promise<void> = async () => {}) {}
  recent(handle: string, force = false, cooldownMs = 10 * 60 * 1000) {
    const current = this.running.get(handle);
    if (current) return current;
    const last = this.store.get<{ recentCheckedAt: string | null }>('training_meta', handle, 'recent')?.recentCheckedAt ?? null;
    if (!force && last && Date.now() - new Date(last).getTime() < cooldownMs)
      return Promise.resolve({ checkedAt: last, error: null });
    const job = (async () => {
      const epoch = this.store.learningEpoch;
      try {
        const submissions = await this.cf.call<CFSubmission[]>('user.status', { handle, from: 1, count: 100 });
        if (epoch !== this.store.learningEpoch) throw new Error('账号或数据已变化，请重新检查提交');
        this.store.ingest(handle, submissions);
        this.store.markRecentChecked(handle);
        await this.persist();
        return { checkedAt: this.store.get<{ recentCheckedAt: string }>('training_meta', handle, 'recent')!.recentCheckedAt, error: null };
      } catch (error) {
        return { checkedAt: last, error: error instanceof Error ? error.message : String(error) };
      }
    })();
    this.running.set(handle, job);
    void job.finally(() => this.running.delete(handle));
    return job;
  }
}
