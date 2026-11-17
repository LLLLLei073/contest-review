import { z } from 'zod';
import { localDay, problemKey, type CoreStore } from './core-store.js';
import { learningNamespace, type LearningRecord } from './learning-domain.js';
import type { Attempt, CFSubmission } from './domain.js';
import {
  categoryNames,
  recommendationDifficulty,
  selectProblems,
  weakTags,
  type Catalog,
  type CategoryName,
} from './training.js';
import { estimateMinutes } from './plan-optimizer.js';
import { buildDay, buildProgram, estimateForRating, phaseCount } from './program-planner.js';
import { buildProgramReport, type ProgramReport } from './program-report.js';
import {
  phaseLabels,
  programAssignment,
  programNamespace,
  programProgress,
  trainingProgramSchema,
  type ProgramAssignment,
  type TrainingProgram,
} from './program-domain.js';

const generateInputSchema = z.object({
  duration: z.union([z.literal(7), z.literal(14)]),
  dailyCount: z.number().int().min(6).max(10).default(8),
  focus: z.array(z.enum(categoryNames)).min(1).max(2).optional(),
});
const idInputSchema = z.object({ id: z.string().min(1).max(200) });
const swapInputSchema = z.object({
  id: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  key: z.string().min(1).max(200),
});
interface ProgramState {
  draft: TrainingProgram | null;
  active: TrainingProgram | null;
  progress: ReturnType<typeof programProgress> | null;
  today: (ProgramAssignment & { date: string; theme: string | null; phase: string | null }) | null;
  analysis: {
    mastery: { name: string; score: number; samples: number }[];
    suggestedFocus: CategoryName[];
    band: { minimum: number; maximum: number; preferred: number; basis: string };
  };
  summary: { total: number; ac: number; independent: number } | null;
  /** 规则版总结报告（纯派生）；completed 显示全量，active 过半显示进行中简版。 */
  report: ProgramReport | null;
  /** 仅 generate 响应携带：生成时的候选不足等提示。 */
  generationWarnings?: string[];
  /** 计划中引用题目的展示信息（key → 题名/难度/链接）。 */
  catalog: Record<string, { name: string; rating: number | null; url: string }>;
}
export class ProgramService {
  constructor(
    readonly store: CoreStore,
    private now: () => Date = () => new Date(),
  ) {}
  scope() {
    if (!this.store.active() && !this.store.activeAtcoder()) throw new Error('请先绑定训练账号');
    return programNamespace(this.store.active() || '-', this.store.activeAtcoder() || '');
  }
  private records(): TrainingProgram[] {
    return this.store
      .externalAll<TrainingProgram>(this.scope())
      .map((r) => trainingProgramSchema.parse(r));
  }
  draft() {
    return this.records().find((p) => p.status === 'draft') ?? null;
  }
  active() {
    return this.records().find((p) => p.status === 'active') ?? null;
  }
  private profiles() {
    return [
      this.store.active(),
      this.store.activeAtcoder() ? 'ac~' + this.store.activeAtcoder().toLowerCase() : '',
    ].filter(Boolean);
  }
  private cfSubmissions() {
    const cf = this.store.active();
    return cf ? this.store.all<CFSubmission>('submissions', cf) : [];
  }
  private allAttempts() {
    return this.profiles().flatMap((p) => this.store.all<Attempt>('attempts', p));
  }
  private acceptedDays(): Map<string, string> {
    const map = new Map<string, string>();
    for (const profile of this.profiles())
      for (const s of this.store.all<CFSubmission>('submissions', profile)) {
        if (s.verdict !== 'OK' || s.author.teamId) continue;
        const day = localDay(new Date(s.creationTimeSeconds * 1000));
        const key = problemKey(s);
        const existing = map.get(key);
        if (existing === undefined || day < existing) map.set(key, day);
      }
    return map;
  }
  private analysis() {
    const cf = this.store.active();
    const rows = this.store.combinedProblems().filter((p) => !p.review.ignored);
    const submissions = this.cfSubmissions();
    const attempts = this.allAttempts();
    const reviews = new Map(rows.map((r) => [r.key, r.review]));
    const mastery = this.store.combinedStatistics('all', this.now()).mastery;
    const weak = weakTags(rows, submissions, attempts, reviews, problemKey, this.now());
    const official = cf
      ? this.store
          .contests(cf)
          .filter((c) => c.rating)
          .sort(
            (a, b) => (b.rating?.ratingUpdateTimeSeconds ?? 0) - (a.rating?.ratingUpdateTimeSeconds ?? 0),
          )[0]?.rating?.newRating
      : undefined;
    const band = recommendationDifficulty(rows, submissions, problemKey, official);
    const ranked = [...mastery].sort((a, b) => a.score - b.score || b.samples - a.samples);
    const suggested = (ranked.filter((a) => a.samples >= 2).length ? ranked.filter((a) => a.samples >= 2) : ranked)
      .slice(0, 2)
      .map((a) => a.name);
    return { rows, submissions, attempts, mastery, weak, band, suggestedFocus: suggested };
  }
  generate(input: unknown): ProgramState {
    const { duration, dailyCount, focus } = generateInputSchema.parse(input);
    const cf = this.store.active();
    const catalog = cf ? this.store.get<Catalog>('catalog_cache', cf, 'current') : undefined;
    if (!catalog?.problems.length)
      throw new Error('请先完成一次 Codeforces 同步以获取公开题库，再生成训练计划');
    if (this.active()) throw new Error('已有进行中的长期计划，请先放弃当前计划再重新生成');
    const { rows, submissions, attempts, mastery, weak, band, suggestedFocus } = this.analysis();
    const chosen = focus?.length ? (focus as CategoryName[]) : suggestedFocus;
    const blocked = new Set<string>([
      ...submissions.map(problemKey),
      ...rows.map((r) => r.key),
    ]);
    for (const profile of this.profiles())
      for (const plan of this.store.all<{ newKeys: string[] }>('daily_plans', profile))
        for (const key of plan.newKeys) blocked.add(key);
    const minutes = estimateMinutes(
      attempts.filter((a) => a.result === 'independent').map((a) => a.minutes),
      'new',
    );
    const { program, warnings } = buildProgram({
      today: localDay(this.now()),
      duration,
      dailyCount,
      focus: chosen,
      catalog: catalog.problems,
      blocked,
      mastery,
      weak,
      band,
      minutesPerProblem: minutes.minutes,
      minutesBasis: minutes.basis,
    });
    if (weak.size === 0)
      warnings.push('暂无失败与错题记录，针对性权重按掌握度与题目质量先验兜底');
    for (const warning of warnings) console.warn(`[program] ${warning}`);
    if (program.days.every((d) => d.problems.length === 0))
      throw new Error('当前难度基准下没有任何可安排的新题：请先同步题库，或完成几道题以校准难度');
    const record = trainingProgramSchema.parse({
      ...program,
      id: crypto.randomUUID(),
      createdAt: this.now().toISOString(),
    });
    // 一个账号同时只保留一份草稿，重复生成直接覆盖。
    for (const old of this.records().filter((p) => p.status === 'draft'))
      this.store.externalDelete(this.scope(), old.id);
    this.store.externalPut(this.scope(), 'draft', record);
    const result = this.state();
    result.generationWarnings = warnings;
    return result;
  }
  confirm(input: unknown): ProgramState {
    const { id } = idInputSchema.parse(input);
    const found = this.records().find((p) => p.id === id && p.status === 'draft');
    if (!found) throw new Error('计划预览不存在或已失效，请重新生成');
    if (this.active()) throw new Error('已有进行中的长期计划');
    const confirmed = trainingProgramSchema.parse({
      ...found,
      status: 'active',
      confirmedAt: this.now().toISOString(),
      baselineMastery: this.analysis().mastery.map(({ name, score, samples }) => ({ name, score, samples })),
    });
    this.store.externalDelete(this.scope(), 'draft');
    this.store.externalPut(this.scope(), confirmed.id, confirmed);
    return this.state();
  }
  abandon(input: unknown): ProgramState {
    const { id } = idInputSchema.parse(input);
    const found = this.records().find(
      (p) => p.id === id && (p.status === 'draft' || p.status === 'active'),
    );
    if (!found) throw new Error('计划不存在或已结束');
    this.store.externalPut(
      this.scope(),
      found.id,
      trainingProgramSchema.parse({ ...found, status: 'abandoned' }),
    );
    return this.state();
  }
  swap(input: unknown): ProgramState {
    const { id, date, key } = swapInputSchema.parse(input);
    const found = this.records().find(
      (p) => p.id === id && (p.status === 'draft' || p.status === 'active'),
    );
    if (!found) throw new Error('计划不存在或已结束');
    const cf = this.store.active();
    const catalog = cf ? this.store.get<Catalog>('catalog_cache', cf, 'current') : undefined;
    if (!catalog?.problems.length) throw new Error('公开题库缺失，请先重新同步 Codeforces');
    const dayIndex = found.days.findIndex((d) => d.date === date);
    if (dayIndex < 0) throw new Error('该日期不在计划范围内');
    const day = found.days[dayIndex];
    const slotIndex = day.problems.findIndex((p) => p.key === key);
    if (slotIndex < 0) throw new Error('该题不在此日计划中');
    const slot = day.problems[slotIndex];
    const accepted = this.acceptedDays();
    if (found.status === 'active' && accepted.get(key)) throw new Error('该题已完成，不能换题');
    const rows = this.store.combinedProblems().filter((p) => !p.review.ignored);
    const weak = weakTags(
      rows,
      this.cfSubmissions(),
      this.allAttempts(),
      new Map(rows.map((r) => [r.key, r.review])),
      problemKey,
      this.now(),
    );
    // 被换下的题保留在排除集里，避免换题又选中它自身。
    const blocked = new Set<string>([
      ...this.cfSubmissions().map(problemKey),
      ...rows.map((r) => r.key),
      ...found.days.flatMap((d) => d.problems.map((p) => p.key)),
    ]);
    const selection = selectProblems(catalog.problems, blocked, this.analysis().mastery, {
      date,
      count: 1,
      band: { minimum: day.band.minimum, maximum: day.band.maximum, preferred: day.band.preferred },
      focus: day.focus,
      weak,
      role: slot.role,
      relax: true,
    });
    const next = selection.picks[0];
    if (!next) throw new Error('该难度带内暂无可替换的新题，请先同步题库或稍后再试');
    const perProblemMinutes = estimateMinutes(
      this.allAttempts().filter((a) => a.result === 'independent').map((a) => a.minutes),
      'new',
    ).minutes;
    const catalogByKey = new Map(catalog.problems.map((p) => [p.key, p]));
    const days = found.days.map((d, i) => {
      if (i !== dayIndex) return d;
      const problems = d.problems.map((p, j) => (j === slotIndex ? next : p));
      return {
        ...d,
        problems,
        estimateMinutes: problems.reduce(
          (sum, p) => sum + estimateForRating(perProblemMinutes, catalogByKey.get(p.key)?.rating ?? null, d.band.preferred),
          0,
        ),
        reasons: Object.fromEntries(
          Object.entries(d.reasons).filter(([k]) => k !== key && k !== next.key),
        ) as Record<string, string>,
      };
    });
    days[dayIndex].reasons[next.key] =
      `换题（原 ${key}）：${day.reasons[key] ?? phaseLabels[day.phase] + '·' + day.theme}`;
    this.store.externalPut(
      this.scope(),
      found.id,
      trainingProgramSchema.parse({ ...found, days }),
    );
    return this.state();
  }
  /**
   * 中期自适应校准：按前半程完成率调整剩余天（date ≥ 今天）。
   * ≥85% 难度 +100；<50% 难度 −100 且训练日题量 −1（min 4）；中间只刷新选题。phase 序列与日期保持不变。
   */
  recalibrate(input: unknown): ProgramState {
    const { id } = idInputSchema.parse(input);
    const found = this.records().find((p) => p.id === id && p.status === 'active');
    if (!found) throw new Error('只有进行中的计划可以校准');
    const today = localDay(this.now());
    const accepted = this.acceptedDays();
    const past = found.days.filter((d) => d.date < today);
    if (past.length < 2) throw new Error('计划开始至少两天后才能校准');
    const total = past.reduce((sum, d) => sum + d.problems.length, 0);
    const ac = past.reduce(
      (sum, d) =>
        sum +
        d.problems.filter((p) => {
          const at = accepted.get(p.key);
          return at !== undefined && at <= d.date;
        }).length,
      0,
    );
    if (!total) throw new Error('前半程还没有已安排的题目，无法校准');
    const acRate = ac / total;
    const shift = acRate >= 0.85 ? 100 : acRate < 0.5 ? -100 : 0;
    const dailyCount = acRate < 0.5 ? Math.max(4, found.dailyCount - 1) : found.dailyCount;
    const note =
      shift > 0
        ? `前半程完成率 ${Math.round(acRate * 100)}%（${ac}/${total}），执行力强：剩余天难度上调 100`
        : shift < 0
          ? `前半程完成率 ${Math.round(acRate * 100)}%（${ac}/${total}），负荷下调：剩余天难度回落 100，训练日每天 ${dailyCount} 题`
          : `前半程完成率 ${Math.round(acRate * 100)}%（${ac}/${total}），节奏正常：刷新剩余选题`;
    const cf = this.store.active();
    const catalog = cf ? this.store.get<Catalog>('catalog_cache', cf, 'current') : undefined;
    if (!catalog?.problems.length) throw new Error('公开题库缺失，无法重新选题，请先同步 Codeforces');
    const { rows, mastery, weak } = this.analysis();
    const minutesPerProblem = estimateMinutes(
      this.allAttempts().filter((a) => a.result === 'independent').map((a) => a.minutes),
      'new',
    ).minutes;
    const blocked = new Set<string>([
      ...this.cfSubmissions().map(problemKey),
      ...rows.map((r) => r.key),
      ...past.flatMap((d) => d.problems.map((p) => p.key)),
    ]);
    const clamped = (n: number) => Math.max(800, Math.min(3500, n));
    const days = found.days.map((day, i) => {
      if (day.date < today) return day;
      // 减负荷由 dailyCount −1 传导（min 4），训练日与特殊日都按同一 dailyCount 换算。
      const count = Math.max(4, phaseCount(day.phase, dailyCount));
      return buildDay({
        date: day.date,
        index: i,
        phase: day.phase,
        block: day.phase === 'reinforce' ? (/强化II/.test(day.theme) ? 'II' : 'I') : undefined,
        count,
        band: {
          minimum: clamped(day.band.minimum + shift),
          maximum: clamped(day.band.maximum + shift),
          preferred: clamped(day.band.preferred + shift),
        },
        focus: day.focus,
        catalog: catalog.problems,
        blocked,
        mastery,
        weak,
        minutesPerProblem,
        reasonPrefix: '校准后',
      });
    });
    if (days.every((d) => d.problems.length === 0)) throw new Error('校准后没有可选的新题，请先同步题库');
    const updated = trainingProgramSchema.parse({
      ...found,
      days,
      dailyCount,
      recalibrations: [
        ...(found.recalibrations ?? []),
        { at: this.now().toISOString(), acRate, shift, note },
      ].slice(-4),
    });
    this.store.externalPut(this.scope(), updated.id, updated);
    return this.state();
  }
  private summary(program: TrainingProgram, accepted: Map<string, string>) {
    const keys = [...new Set(program.days.flatMap((d) => d.problems.map((p) => p.key)))];
    const attempts = this.allAttempts();
    return {
      total: keys.length,
      ac: keys.filter((k) => accepted.has(k)).length,
      independent: new Set(
        attempts.filter((a) => a.result === 'independent' && keys.includes(a.problemKey)).map((a) => a.problemKey),
      ).size,
    };
  }
  /** 规则版总结报告：active/completed 可用（进行中给出截至今天的进度口径）。 */
  report() {
    const program =
      this.active() ?? this.records().find((p) => p.status === 'completed') ?? null;
    if (!program) throw new Error('没有进行中或已完成的长期计划');
    const accepted = this.acceptedDays();
    const transfers = this.store
      .externalAll<LearningRecord>(
        learningNamespace(this.store.active() || '-', this.store.activeAtcoder()),
      )
      .filter((r) => r.kind === 'transfer')
      .map((r) => ({
        result: r.kind === 'transfer' ? r.result : '',
        problemKey: r.kind === 'transfer' ? r.problemKey : '',
        targetKey: r.kind === 'transfer' ? r.targetKey : '',
      }));
    const report = buildProgramReport({
      program,
      acceptedDays: accepted,
      attempts: this.allAttempts(),
      transfers,
      currentMastery: this.analysis().mastery,
      today: localDay(this.now()),
    });
    return { program, report };
  }
  state(): ProgramState {
    const program = this.active() ?? this.records().find((p) => p.status === 'completed') ?? null;
    const accepted = this.acceptedDays();
    let progress: ProgramState['progress'] = null;
    if (program) {
      progress = programProgress(program, localDay(this.now()), accepted);
      // 全部完成后自动收束（最后一天在当天或已过），避免状态滞留。
      if (
        progress.percent === 100 &&
        program.status === 'active' &&
        (program.days.at(-1)?.date ?? '') <= localDay(this.now())
      ) {
        const finished = trainingProgramSchema.parse({
          ...program,
          status: 'completed',
          finishedAt: this.now().toISOString(),
        });
        this.store.externalPut(this.scope(), finished.id, finished);
        progress = programProgress(finished, localDay(this.now()), accepted);
        return this.composeState(finished, progress, accepted);
      }
    }
    return this.composeState(program, progress, accepted);
  }
  private composeState(
    program: TrainingProgram | null,
    progress: ProgramState['progress'],
    accepted: Map<string, string>,
  ): ProgramState {
    const today = localDay(this.now());
    const assignment = program ? programAssignment(program, today, accepted) : null;
    const day = program && assignment?.dayIndex != null ? program.days[assignment.dayIndex] : null;
    const { mastery, band, suggestedFocus } = this.analysis();
    const draft = this.draft();
    const cf = this.store.active();
    const catalogRows = cf ? this.store.get<Catalog>('catalog_cache', cf, 'current')?.problems ?? [] : [];
    const byKey = new Map(catalogRows.map((p) => [p.key, p]));
    const referenced = [
      ...new Set((program ?? draft)?.days.flatMap((d) => d.problems.map((p) => p.key)) ?? []),
    ];
    const catalog: ProgramState['catalog'] = {};
    for (const key of referenced) {
      const p = byKey.get(key);
      if (p) catalog[key] = { name: p.name, rating: p.rating, url: p.url };
    }
    return {
      draft: this.draft(),
      active: program,
      progress,
      today:
        assignment && day
          ? { ...assignment, date: today, theme: day.theme, phase: day.phase }
          : { keys: [], reasons: {}, shortage: null, dayIndex: null, carryCount: 0, date: today, theme: null, phase: null },
      analysis: { mastery, suggestedFocus, band },
      summary: program ? this.summary(program, accepted) : null,
      report: program ? this.report().report : null,
      catalog,
    };
  }
  route(action: string, method: string, input?: unknown) {
    if (action === 'state' && method === 'GET') return this.state();
    if (action === 'generate' && method === 'POST') return this.generate(input);
    if (action === 'confirm' && method === 'POST') return this.confirm(input);
    if (action === 'abandon' && method === 'POST') return this.abandon(input);
    if (action === 'swap' && method === 'POST') return this.swap(input);
    if (action === 'recalibrate' && method === 'POST') return this.recalibrate(input);
    throw new Error('未知训练计划操作');
  }
}
