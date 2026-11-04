import type { CoreStore } from './core-store.js';
import type { SyncJob } from './domain.js';
export interface PlatformHealth {
  id: 'cf' | 'atcoder' | 'luogu' | 'xcpc';
  name: string;
  account: string;
  bound: boolean;
  lastSuccess: string | null;
  lastAttempt: string | null;
  status: 'unbound' | 'never' | SyncJob['status'];
  error: string | null;
  capabilities: string[];
  href: string;
}
export function platformHealth(store: CoreStore): PlatformHealth[] {
  const accounts = [
    {
      id: 'cf' as const,
      name: 'Codeforces',
      account: store.active(),
      profile: store.active(),
      capabilities: ['公开提交', '题库', '比赛成绩'],
    },
    {
      id: 'atcoder' as const,
      name: 'AtCoder',
      account: store.activeAtcoder(),
      profile: 'ac~' + store.activeAtcoder().toLowerCase(),
      capabilities: ['公开提交', '题库', '比赛成绩'],
    },
    {
      id: 'luogu' as const,
      name: '洛谷',
      account: store.activeLuogu(),
      profile: 'lg~' + store.activeLuogu(),
      capabilities: ['公开做题记录'],
    },
    {
      id: 'xcpc' as const,
      name: 'XCPC',
      account: store.setting('xcpc-active'),
      profile: '',
      capabilities: ['队伍比赛资料', '不提供个人逐题提交'],
    },
  ];
  return accounts.map((a) => {
    const jobs =
      a.account && a.profile
        ? store.all<SyncJob>('jobs', a.profile).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        : [];
    const latest = jobs.at(-1);
    let xcpc: { lastSuccess?: string; lastAttempt?: string; status?: SyncJob['status']; error?: string } = {};
    if (a.id === 'xcpc' && a.account) {
      try {
        xcpc = JSON.parse(store.setting('xcpc-health:' + a.account) || '{}');
      } catch {
        /* legacy metadata */
      }
    }
    return {
      id: a.id,
      name: a.name,
      account: a.account,
      bound: !!a.account,
      lastSuccess:
        jobs.filter((j) => j.status === 'completed').at(-1)?.finishedAt ?? xcpc.lastSuccess ?? null,
      lastAttempt: latest?.startedAt ?? xcpc.lastAttempt ?? null,
      status: !a.account ? 'unbound' : (latest?.status ?? xcpc.status ?? 'never'),
      error:
        latest && ['failed', 'interrupted'].includes(latest.status) ? latest.message : (xcpc.error ?? null),
      capabilities: a.capabilities,
      href: `/settings?view=${a.account ? 'sync' : 'accounts'}&platform=${a.id}`,
    };
  });
}
