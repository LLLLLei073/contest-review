import { z } from 'zod';

export const reasonOptions = [
  '思路缺失',
  '算法不熟',
  '边界遗漏',
  '实现错误',
  '复杂度超限',
  '读题失误',
  '数学推导',
  '时间分配',
];
export const reviewSchema = z.object({
  wrongIdea: z.string().max(100000).default(''),
  rootCause: z.string().max(100000).default(''),
  solution: z.string().max(100000).default(''),
  complexity: z.string().max(10000).default(''),
  counterexample: z.string().max(100000).default(''),
  code: z.string().max(300000).default(''),
  language: z.string().max(40).default('cpp'),
  reasons: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  status: z.enum(['pending', 'reviewing', 'mastered']).default('pending'),
  ignored: z.boolean().default(false),
  stage: z.number().int().min(0).max(5).default(0),
  nextReview: z.string().datetime().nullable().default(null),
});
export type Review = z.infer<typeof reviewSchema>;
export const attemptSchema = z.object({
  result: z.enum(['independent', 'hint', 'failed']),
  minutes: z.number().min(0).max(100000),
  note: z.string().max(100000).default(''),
});
export type AttemptInput = z.infer<typeof attemptSchema>;
export type Attempt = AttemptInput & { id: string; problemKey: string; createdAt: string };
export const problemSchema = z.object({
  key: z.string().min(1).max(200),
  contestId: z.number().int().positive().nullable(),
  index: z.string().max(40),
  name: z.string().min(1).max(1000),
  rating: z.number().nonnegative().nullable(),
  tags: z.array(z.string().max(100)).max(100),
  url: z.url().refine((v) => /^https?:\/\//.test(v)),
  manual: z.boolean().default(false),
});
export type Problem = z.infer<typeof problemSchema>;
export type ProblemRow = Problem & {
  review: Review;
  solved: boolean;
  failures: number;
  submissionCount: number;
};
export interface CFSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds?: number;
  problem: {
    contestId?: number;
    problemsetName?: string;
    index: string;
    name: string;
    rating?: number;
    tags: string[];
  };
  verdict?: string;
  programmingLanguage: string;
  author: {
    participantType: string;
    startTimeSeconds?: number;
    teamId?: number;
    members?: { handle: string }[];
    ghost?: boolean;
  };
}
export interface CFContest {
  id: number;
  name: string;
  startTimeSeconds?: number;
  durationSeconds?: number;
  phase?: string;
  type?: 'CF' | 'IOI' | 'ICPC';
  frozen?: boolean;
}
export interface CFRating {
  contestId: number;
  contestName: string;
  oldRating: number;
  newRating: number;
  rank: number;
  ratingUpdateTimeSeconds?: number;
}
export interface ContestReview {
  timeAllocation: string;
  mistakes: string;
  improvements: string;
}
export interface ContestRow {
  id: number;
  name: string;
  startTimeSeconds?: number;
  types: string[];
  problemCount: number;
  solvedCount: number;
  rating?: CFRating;
  review: ContestReview;
  inContestSolved: number | null;
  analysisStatus: string;
  analysisScore: number | null;
}
export interface SyncJob {
  id: string;
  handle: string;
  mode: 'full' | 'incremental';
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  processed: number;
  cursor: number;
  message: string;
  startedAt: string;
  finishedAt?: string;
}
export interface Settings {
  activeHandle: string;
  handles: string[];
}
export interface Statistics {
  total: number;
  unsolved: number;
  mastered: number;
  due: number;
  pending: number;
  submissions: number;
  reasons: [string, number][];
  tags: [string, number][];
  trend: { date: string; independent: number; hint: number; failed: number }[];
}
export const failures = new Set([
  'WRONG_ANSWER',
  'TIME_LIMIT_EXCEEDED',
  'MEMORY_LIMIT_EXCEEDED',
  'RUNTIME_ERROR',
  'COMPILATION_ERROR',
  'PARTIAL',
  'CHALLENGED',
  'IDLENESS_LIMIT_EXCEEDED',
  'SECURITY_VIOLATED',
]);
export const verdictLabel: Record<string, string> = {
  OK: 'AC',
  WRONG_ANSWER: 'WA',
  TIME_LIMIT_EXCEEDED: 'TLE',
  MEMORY_LIMIT_EXCEEDED: 'MLE',
  RUNTIME_ERROR: 'RE',
  COMPILATION_ERROR: 'CE',
  PARTIAL: '部分得分',
  CHALLENGED: '被 Hack',
  TESTING: '评测中',
  SUBMITTED: '待评测',
};
export function emptyReview(): Review {
  return reviewSchema.parse({});
}
export function nextReviewState(review: Review, result: AttemptInput['result'], now = new Date()): Review {
  const next = { ...review, status: 'reviewing' as Review['status'], ignored: false };
  let days = 1;
  if (result === 'independent') {
    next.stage = Math.min(5, review.stage + 1);
    days = [3, 7, 14, 30][next.stage - 1] ?? 0;
  } else if (result === 'failed') next.stage = 0;
  if (next.stage === 5 && result === 'independent') {
    next.status = 'mastered';
    next.nextReview = null;
  } else next.nextReview = new Date(now.getTime() + days * 86400000).toISOString();
  return next;
}
