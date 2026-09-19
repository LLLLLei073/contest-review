import type { AnalysisCache, AnalysisInput } from '../shared/contest-analysis';
import type { CFContest, CFRating, CFSubmission } from '../shared/domain';
export const contest: CFContest & { rating: CFRating } = {
  id: 9000,
  name: 'Analysis Fixture Round',
  type: 'CF',
  phase: 'FINISHED',
  frozen: false,
  startTimeSeconds: 1730000000,
  durationSeconds: 3600,
  rating: {
    contestId: 9000,
    contestName: 'Analysis Fixture Round',
    rank: 11,
    oldRating: 1400,
    newRating: 1410,
    ratingUpdateTimeSeconds: 1730004000,
  },
};
export function submission(
  id: number,
  seconds: number,
  verdict = 'OK',
  index = 'A',
  type = 'CONTESTANT',
  start = contest.startTimeSeconds!,
  contestId = 9000,
): CFSubmission {
  return {
    id,
    contestId,
    creationTimeSeconds: start + seconds,
    relativeTimeSeconds: seconds,
    problem: { contestId, index, name: 'Problem ' + index, rating: 1400, tags: ['dp'] },
    verdict,
    programmingLanguage: 'C++',
    author: { participantType: type, startTimeSeconds: start, members: [{ handle: 'tester' }] },
  };
}
export function fixtureInput(): AnalysisInput {
  const problems = ['A', 'B'].map((index) => ({
    contestId: 9000,
    index,
    name: 'Problem ' + index,
    rating: 1400,
    tags: ['dp'],
  }));
  const rows = Array.from({ length: 21 }, (_, i) => ({
    party: { participantType: 'CONTESTANT', members: [{ handle: i === 10 ? 'tester' : 'peer' + i }] },
    rank: i + 1,
    points: 100 - i,
  }));
  const cache: AnalysisCache = {
    id: 9000,
    fetchedAt: '2026-09-19T00:00:00.000Z',
    standings: { contest, problems, rows },
    ratings: rows.map((r) => ({ handle: r.party.members[0].handle, oldRating: 1400, newRating: 1410 })),
    warnings: [],
    submissionsComplete: true,
  };
  const history = Array.from({ length: 3 }, (_, i) => ({
    ...contest,
    id: 8999 - i,
    startTimeSeconds: contest.startTimeSeconds! - 86400 * (i + 1),
    rating: {
      ...contest.rating,
      contestId: 8999 - i,
      ratingUpdateTimeSeconds: contest.startTimeSeconds! - 86400 * (i + 1) + 4000,
    },
  }));
  return {
    handle: 'tester',
    contest,
    contests: [contest, ...history],
    cache,
    complete: true,
    problems,
    submissions: [
      submission(1, 100, 'WRONG_ANSWER'),
      submission(2, 200, 'COMPILATION_ERROR'),
      submission(3, 300, 'COMPILATION_ERROR'),
      submission(4, 600),
      submission(5, 700),
      submission(6, 4000, 'OK', 'B', 'PRACTICE'),
      ...history.map((c, i) => submission(20 + i, 900, 'OK', 'A', 'CONTESTANT', c.startTimeSeconds, c.id)),
    ],
  };
}
