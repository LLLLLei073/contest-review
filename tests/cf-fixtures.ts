import type { CFSubmission } from '../shared/domain';
import { fixtureInput } from './analysis-fixtures';
const names = [
  'Two Screens',
  'Turtle and a MEX Problem',
  'Longest Good Array',
  'Doremy’s Connecting Plan',
  'Beautiful Sequence',
  'Counting Paths',
  'Binary String Reconstruction',
  'Equalize',
];
const tags = [
  ['greedy', 'strings'],
  ['dp', 'number theory'],
  ['math', 'binary search'],
  ['graphs', 'dsu'],
  ['dp', 'combinatorics'],
  ['trees', 'dfs and similar'],
  ['constructive algorithms'],
  ['data structures', 'sortings'],
];
export const fixtureNewProblems: CFSubmission['problem'][] = Array.from({ length: 10 }, (_, i) => ({
  contestId: 3100 + i, index: 'A', name: `New Knowledge ${i + 1}`,
  tags: tags[i % tags.length], rating: 1100 + (i % 6) * 100,
}));
export const fixtureSubmissions: CFSubmission[] = names
  .flatMap((name, i) => {
    const submission: CFSubmission = {
      id: 100 + i * 2,
      contestId: 2000 + i,
      creationTimeSeconds: 1789600000 + i * 100,
      problem: {
        contestId: 2000 + i,
        index: i % 3 === 0 ? 'C' : 'B',
        name,
        tags: tags[i],
        rating: 1200 + i * 100,
      },
      verdict: i === 2 ? 'TIME_LIMIT_EXCEEDED' : 'WRONG_ANSWER',
      programmingLanguage: 'GNU C++20',
      author: { participantType: i === 3 ? 'PRACTICE' : i === 4 ? 'VIRTUAL' : 'CONTESTANT' },
    };
    return [submission, ...(i % 2 === 0 ? [{ ...submission, id: 101 + i * 2, verdict: 'OK' }] : [])];
  })
  .sort((a, b) => b.id - a.id);
export function fixtureResult(method: string, params: Record<string, string | number>) {
  if (Number(params.contestId) === 9000) {
    const input = fixtureInput();
    if (method === 'contest.standings') return input.cache!.standings;
    if (method === 'contest.ratingChanges') return input.cache!.ratings;
    if (method === 'contest.status')
      return input.submissions
        .filter((s) => s.contestId === 9000)
        .slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count));
  }
  if (method === 'user.info') return [{ handle: String(params.handles) }];
  if (method === 'user.status')
    return fixtureSubmissions.slice(Number(params.from) - 1, Number(params.from) - 1 + Number(params.count));
  if (method === 'contest.list')
    return names.map((_, i) => ({
      id: 2000 + i,
      name: `Codeforces Round ${980 + i} (Div. 2)`,
      startTimeSeconds: 1789500000 + i * 86400,
    }));
  if (method === 'problemset.problems') return { problems: [...fixtureSubmissions.map((s) => s.problem), ...fixtureNewProblems] };
  if (method === 'user.rating')
    return [
      {
        contestId: 2000,
        contestName: 'Codeforces Round 980 (Div. 2)',
        oldRating: 1400,
        newRating: 1447,
        rank: 1200,
      },
    ];
  return [];
}
