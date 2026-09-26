import { z } from 'zod';
import type { ContestReview } from './domain.js';

export const XCPC_BASE = 'https://hei-maom.github.io/xcpcrating/data/';
export const xcpcCandidateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  org: z.string(),
  contests: z.number().int().nonnegative(),
});
export type XcpcCandidate = z.infer<typeof xcpcCandidateSchema>;
const num = z.number().finite().nullable().optional();
export const xcpcHistorySchema = z.object({
  contestId: z.string().min(1),
  title: z.string().min(1),
  startAt: z.string(),
  teamName: z.string(),
  rank: z.number().nonnegative(),
  teamCount: z.number().nonnegative(),
  official: z.boolean().default(true),
  rated: z.boolean().default(true),
  ratedOfficial: z.boolean().default(true),
  perf: num,
  perfOfficial: num,
  rating_after: num,
  ratingAfterOfficial: num,
  rankOfficial: num,
  teamCountOfficial: num,
  solved: num,
  rankPercent: num,
  dirt: num,
  dirtWrong: num,
  dirtSolved: num,
  firstATime: num,
  lastHourSolved: num,
  tier: z.string().optional(),
});
export type XcpcHistory = z.infer<typeof xcpcHistorySchema>;
export const xcpcPlayerSchema = xcpcCandidateSchema.extend({ history: z.array(xcpcHistorySchema) });
export type XcpcPlayer = z.infer<typeof xcpcPlayerSchema>;
export const xcpcProblemSchema = z.object({
  alias: z.string(),
  title: z.string().nullable().optional(),
  problemUrl: z
    .string()
    .url()
    .refine((s) => /^https?:\/\//.test(s))
    .nullable()
    .optional(),
  typeLabels: z.array(z.string()).optional(),
  detailTags: z.array(z.string()).optional(),
  accepted: num,
  submitted: num,
  solveRate: num,
  problemRating: num,
});
export const xcpcTeamSchema = z.object({
  rank: z.number(),
  name: z.string(),
  org: z.string(),
  solved: z.number(),
  penalty: z.number(),
  official: z.boolean(),
  members: z.array(z.object({ key: z.string(), name: z.string() })),
  perf: num,
  perfOfficial: num,
  rankOfficial: num,
  predictedRank: num,
  predictedRankOfficial: num,
  preRating: num,
  preRatingOfficial: num,
});
export const xcpcContestSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  startAt: z.string(),
  category: z.string(),
  tier: z.string(),
  teamCount: z.number(),
  unrated: z.boolean().optional(),
  archiveOnly: z.boolean().optional(),
  problems: z.array(xcpcProblemSchema).optional(),
  teams: z.array(xcpcTeamSchema),
});
export type XcpcContest = z.infer<typeof xcpcContestSchema>;
export const xcpcReportSchema = z
  .object({
    playerKey: z.string(),
    contestId: z.string(),
    fetchedAt: z.string().datetime(),
    source: z.literal('xcpcrating'),
    sourceUrl: z
      .string()
      .url()
      .refine((s) => s.startsWith('https://hei-maom.github.io/xcpcrating/#/')),
    detail: xcpcContestSchema,
    advice: z.array(z.object({ evidence: z.string(), issue: z.string(), action: z.string() })),
  })
  .refine((r) => r.detail.slug === r.contestId);
export type XcpcReport = z.infer<typeof xcpcReportSchema>;
export const batchJobSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  phase: z.string(),
  processed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
});
export type BatchJob = z.infer<typeof batchJobSchema>;

export function xcpcRecordSchema(namespace: string, key: string): z.ZodType {
  if (namespace === 'player') return xcpcPlayerSchema.refine((p) => p.key === key);
  if (namespace === 'batch') return batchJobSchema.refine((j) => j.id === key);
  if (namespace.startsWith('xcpc:')) {
    if (key.startsWith('history:')) return xcpcHistorySchema.refine((h) => h.contestId === key.slice(8));
    if (key.startsWith('report:'))
      return xcpcReportSchema.refine(
        (r) => r.playerKey === namespace.slice(5) && r.contestId === key.slice(7),
      );
    if (key.startsWith('review:'))
      return z.object({
        timeAllocation: z.string().max(100000),
        mistakes: z.string().max(100000),
        improvements: z.string().max(100000),
      });
  }
  throw new Error('备份包含未知外部记录');
}

// RFC 1321 MD5, used only to address the publisher's public JSON shards.
export function md5(value: string): string {
  const source = new TextEncoder().encode(value),
    length = source.length;
  const bytes = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  bytes.set(source);
  bytes[length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, (length * 8) >>> 0, true);
  view.setUint32(bytes.length - 4, Math.floor(length / 0x20000000), true);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0,
  );
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let offset = 0; offset < bytes.length; offset += 64) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number, s: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
        s = shifts[i % 4];
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
        s = shifts[4 + (i % 4)];
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
        s = shifts[8 + (i % 4)];
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
        s = shifts[12 + (i % 4)];
      }
      const sum = (a + f + constants[i] + view.getUint32(offset + 4 * g, true)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << s) | (sum >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((n) =>
      Array.from({ length: 4 }, (_, i) => ((n >>> (8 * i)) & 255).toString(16).padStart(2, '0')).join(''),
    )
    .join('');
}

export class XcpcClient {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private fetcher: typeof fetch = fetch,
    private interval = 500,
  ) {}
  private request(path: string): Promise<unknown> {
    const run = this.tail.then(async () => {
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await this.fetcher.call(globalThis, XCPC_BASE + path, {
            signal: AbortSignal.timeout(20000),
            credentials: 'omit',
          });
          if (!response.ok) throw new Error(`XCPC HTTP ${response.status}`);
          return await response.json();
        } catch (e) {
          last = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
      throw new Error(`无法读取 XCPC 数据：${last instanceof Error ? last.message : String(last)}`);
    });
    this.tail = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, this.interval)));
    return run;
  }
  async search(name: string): Promise<XcpcCandidate[]> {
    const q = name.trim();
    if (!q || q.length > 80) throw new Error('请输入选手姓名');
    const shard = md5(Array.from(q.toLowerCase())[0]).slice(0, 2);
    const rows = z
      .array(z.tuple([z.string(), z.string(), z.string(), z.number()]))
      .parse(await this.request(`search/players/${shard}.json`));
    return rows
      .filter((r) => r[1].toLowerCase().includes(q.toLowerCase()))
      .slice(0, 30)
      .map(([key, name, org, contests]) => ({ key, name, org, contests }));
  }
  async player(key: string): Promise<XcpcPlayer> {
    const shard = md5(key).slice(0, 2);
    const map = z.record(z.string(), z.unknown()).parse(await this.request(`players/${shard}.json`));
    if (!map[key]) throw new Error('XCPC 选手已不在公开数据中');
    return xcpcPlayerSchema.parse(map[key]);
  }
  async contest(slug: string): Promise<XcpcContest> {
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error('比赛编号无效');
    return xcpcContestSchema.parse(await this.request(`contests/${slug}.json`));
  }
  async contestTiers(): Promise<Map<string, string>> {
    const rows = z
      .array(z.object({ slug: z.string(), tier: z.string() }))
      .parse(await this.request('contests-index.json'));
    return new Map(rows.map((r) => [r.slug, r.tier]));
  }
}

export function xcpcScore(h: XcpcHistory, mode: 'official' | 'all') {
  return mode === 'official'
    ? h.official && h.ratedOfficial
      ? (h.perfOfficial ?? null)
      : null
    : h.rated
      ? (h.perf ?? null)
      : null;
}
export function xcpcAdvice(
  current: XcpcHistory,
  history: XcpcHistory[],
  mode: 'official' | 'all',
  detail?: XcpcContest,
  playerKey?: string,
) {
  const advice: { evidence: string; issue: string; action: string }[] = [];
  const previous = history
    .filter(
      (h) =>
        h.contestId !== current.contestId &&
        Date.parse(h.startAt) < Date.parse(current.startAt) &&
        !!current.tier &&
        h.tier === current.tier &&
        xcpcScore(h, mode) !== null,
    )
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .slice(0, 5);
  const median = (numbers: number[]) => {
    const sorted = [...numbers].sort((a, b) => a - b);
    const n = sorted.length;
    return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
  };
  if ((current.dirt ?? 0) >= 1)
    advice.push({
      evidence: `本场每道已解题平均有 ${current.dirt} 次首次 AC 前错误提交。`,
      issue: '提交前验证可能不足。',
      action: '下一场为关键边界造反例并跑通样例后再提交。',
    });
  if (previous.length >= 3) {
    const first = median(previous.flatMap((h) => (h.firstATime == null ? [] : [h.firstATime])));
    if (first !== null && current.firstATime != null && current.firstATime >= first + 10)
      advice.push({
        evidence: `首次 AC 用时 ${current.firstATime} 分钟，近 ${previous.length} 场同级比赛中位数 ${first} 分钟。`,
        issue: '开场推进低于个人历史。',
        action: '练习开场 20 分钟内先确认最易题并完成一次提交。',
      });
    const rankPercent = (h: XcpcHistory) => {
      const rank = mode === 'official' ? h.rankOfficial : h.rank,
        count = mode === 'official' ? h.teamCountOfficial : h.teamCount;
      return rank != null && count != null && count > 0
        ? Math.round((1000 * (rank - 0.5)) / count) / 10
        : null;
    };
    const ranks = median(previous.flatMap((h) => (rankPercent(h) == null ? [] : [rankPercent(h)!])));
    const currentRank = rankPercent(current);
    if (ranks !== null && currentRank !== null && currentRank >= ranks + 10)
      advice.push({
        evidence: `本场排名前 ${currentRank}%，近 ${previous.length} 场同级比赛中位数前 ${ranks}%。`,
        issue: '相对名次低于个人历史。',
        action: '复盘失分题并安排同级限时训练。',
      });
  }
  const team = detail?.teams.find((t) => t.members.some((m) => m.key === playerKey));
  const rank = mode === 'official' ? team?.rankOfficial : team?.rank;
  const predicted = mode === 'official' ? team?.predictedRankOfficial : team?.predictedRank;
  const population = mode === 'official' ? current.teamCountOfficial : current.teamCount;
  if (rank != null && predicted != null && population && rank - predicted >= population * 0.1)
    advice.push({
      evidence: `队伍实际排名 #${rank}，赛前预测 #${predicted}，相差 ${rank - predicted} 名。`,
      issue: '本场结果低于来源预测基线。',
      action: '先核对未解题和罚时，记录导致排名差距的可控因素。',
    });
  const perf = mode === 'official' ? team?.perfOfficial : team?.perf;
  const pre = mode === 'official' ? team?.preRatingOfficial : team?.preRating;
  if (perf != null && pre != null && perf <= pre - 200)
    advice.push({
      evidence: `队伍表现分 ${perf}，赛前队伍分 ${pre}，低 ${Math.round(pre - perf)} 分。`,
      issue: '本场表现低于赛前水平。',
      action: '复盘本场时间分配，并安排相近赛制的限时训练。',
    });
  if (advice.length === 0 && current.solved != null)
    advice.push({
      evidence: `本场完成 ${current.solved} 题，排名 ${current.rank}/${current.teamCount}。`,
      issue: '当前汇总数据未触发明确问题。',
      action: '保留本场有效做法，并在补充笔记中记录关键决策。',
    });
  return advice.slice(0, 3);
}
export function emptyContestReview(): ContestReview {
  return { timeAllocation: '', mistakes: '', improvements: '' };
}
