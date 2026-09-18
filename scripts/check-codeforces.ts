import { CodeforcesClient } from '../server/sync.js';
import { Store } from '../server/store.js';
import type { CFSubmission, CFContest, CFRating } from '../shared/domain.js';
const cf = new CodeforcesClient();
let handle = process.argv[2] || 'tourist';
const store = new Store(':memory:');
try {
  const users = await cf.call<{ handle: string }[]>('user.info', { handles: handle });
  handle = users[0].handle;
  store.activate(users[0].handle);
  const submissions = await cf.call<CFSubmission[]>('user.status', { handle, from: 1, count: 10 });
  store.ingest(handle, submissions);
  const contests = await cf.call<CFContest[]>('contest.list');
  const ratings = await cf.call<CFRating[]>('user.rating', { handle });
  const problems = await cf.call<{ problems: CFSubmission['problem'][] }>('problemset.problems');
  store.enrich(handle, contests, ratings, problems.problems);
  console.log(
    JSON.stringify(
      {
        status: 'OK',
        handle,
        submissions: submissions.length,
        contests: contests.length,
        ratingEntries: ratings.length,
        problemset: problems.problems.length,
        note: 'Read-only live API smoke test; database is in memory.',
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
