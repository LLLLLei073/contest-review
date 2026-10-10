import type { CoreStore } from './core-store.js';
import { problemKey } from './core-store.js';
import { categories } from './training.js';
import type { CFSubmission, Problem, Review } from './domain.js';
import { weekStart } from './weekly.js';
import { growthRecordSchema, type GrowthEvent, type WeeklyGrowth } from './growth-domain.js';

export function weeklyGrowth(store: CoreStore, scope: string, events: GrowthEvent[], now = new Date()) {
  const snapshots = store.externalAll(scope).flatMap((raw) => {
    const parsed = growthRecordSchema.safeParse(raw);
    return parsed.success && parsed.data.kind === 'weekly' && parsed.data.scope === scope
      ? [parsed.data]
      : [];
  });
  const empty: WeeklyGrowth = {
    week: weekStart(now),
    goal: null,
    activatedAt: null,
    complete: false,
    earned: 0,
    tasks: [],
    unclassified: 0,
  };
  if (!snapshots.length) return { current: empty, bonus: [], weeks: 0 };
  const profiles = [
    store.active(),
    store.activeAtcoder() ? 'ac~' + store.activeAtcoder().toLowerCase() : '',
  ].filter(Boolean);
  const fieldMap = new Map<string, string[]>();
  for (const profile of profiles) {
    const problems = new Map(store.all<Problem>('problems', profile).map((p) => [p.key, p]));
    const submissions = store.all<CFSubmission>('submissions', profile);
    const submissionTags = new Map(submissions.map((s) => [problemKey(s), s.problem.tags ?? []]));
    for (const e of events.filter((e) => e.profile === profile)) {
      const key = e.problemKey;
      const tags = problems.get(key)?.tags ?? submissionTags.get(key) ?? [];
      const fields = profile.startsWith('ac~')
        ? (store.get<Review>('reviews', profile, key)?.categories ?? [])
        : tags.length
          ? categories(tags)
          : [];
      fieldMap.set(profile + '\0' + key, fields);
    }
  }
  const identity = (e: GrowthEvent) => e.profile + '\0' + e.problemKey;
  const results: WeeklyGrowth[] = [];
  const bonus: GrowthEvent[] = [];
  for (const record of snapshots) {
    if (record.week > weekStart(now)) continue;
    const end = new Date(record.week + 'T00:00:00+08:00').getTime() + 7 * 86400000;
    const start = Date.parse(record.week + 'T00:00:00+08:00');
    const weekEvents = events
      .filter((e) => Date.parse(e.at) >= start && Date.parse(e.at) < end && Date.parse(e.at) <= now.getTime())
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const fields = (e: GrowthEvent) =>
      (fieldMap.get(identity(e)) ?? []).filter((c) =>
        record.goal.categories.includes(c as (typeof record.goal.categories)[number]),
      );
    const specs = [
      {
        id: 'breakthrough',
        title: '目标突破',
        target: 5,
        xp: 60,
        kinds: ['ac', 'independent'],
        coverageTarget: record.goal.mode === 'balanced' ? 2 : 1,
      },
      { id: 'independent', title: '独立回解', target: 2, xp: 70, kinds: ['independent'], coverageTarget: 1 },
      { id: 'reflection', title: '思路归档', target: 3, xp: 50, kinds: ['reflection'], coverageTarget: 1 },
    ];
    const tasks = specs.map((spec) => {
      const seen = new Set<string>();
      const evidence = weekEvents.filter(
        (e) =>
          spec.kinds.includes(e.kind) &&
          fields(e).length &&
          !seen.has(identity(e)) &&
          !!seen.add(identity(e)),
      );
      // Bipartite matching: one problem can cover at most one target field.
      const coverage = (items: GrowthEvent[]) => {
        const matched = new Map<string, number>();
        function assign(index: number, visited: Set<string>): boolean {
          for (const field of fields(items[index]!)) {
            if (visited.has(field)) continue;
            visited.add(field);
            const old = matched.get(field);
            if (old === undefined || assign(old, visited)) {
              matched.set(field, index);
              return true;
            }
          }
          return false;
        }
        items.forEach((_, i) => assign(i, new Set()));
        return [...matched.keys()];
      };
      let completedAt: string | null = null;
      let proof = evidence;
      for (let i = spec.target; i <= evidence.length; i++) {
        if (coverage(evidence.slice(0, i)).length >= spec.coverageTarget) {
          completedAt = evidence[i - 1]!.at;
          proof = evidence.slice(0, i);
          break;
        }
      }
      if (completedAt)
        bonus.push({
          id: JSON.stringify([scope, record.week, spec.id]),
          profile: profiles.join(' + '),
          problemKey: '',
          title: `${record.week} 周任务 · ${spec.title}`,
          url: null,
          canReview: false,
          kind: 'weekly',
          at: completedAt,
          day: new Date(Date.parse(completedAt) + 8 * 3600000).toISOString().slice(0, 10),
          xp: spec.xp,
          condition: `${record.goal.categories.join('、')} · ${spec.target} 道不同题目${spec.coverageTarget > 1 ? '，至少两个领域' : ''}`,
          evidence: proof.map(({ profile, problemKey, title }) => ({ profile, problemKey, title })),
        });
      return {
        ...spec,
        progress: evidence.length,
        complete: !!completedAt,
        completedAt,
        evidence: proof,
        coverage: coverage(evidence),
      };
    });
    results.push({
      week: record.week,
      goal: record.goal,
      activatedAt: record.activatedAt,
      complete: tasks.every((t) => t.complete),
      earned: tasks.filter((t) => t.complete).reduce((n, t) => n + t.xp, 0),
      tasks,
      unclassified: new Set(weekEvents.filter((e) => !(fieldMap.get(identity(e)) ?? []).length).map(identity))
        .size,
    });
  }
  const current = results.find((r) => r.week === weekStart(now)) ?? empty;
  return { current, bonus, weeks: results.filter((r) => r.complete).length };
}
