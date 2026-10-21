export const defaultProblemFilters = {
  q: '',
  source: 'all',
  tag: '',
  reason: '',
  status: '',
  solved: '',
  ignored: 'no',
  min: '',
  max: '',
  due: '',
  contestId: '',
};
export type ProblemFilters = typeof defaultProblemFilters;
export function parseProblemFilters(query: Record<string, unknown>) {
  const str = (key: string, limit = 200) =>
    typeof query[key] === 'string' ? (query[key] as string).trim().slice(0, limit) : '';
  const choice = (key: string, options: string[], fallback = '') =>
    options.includes(str(key)) ? str(key) : fallback;
  const number = (key: string, minimum: number, maximum: number) => {
    const text = typeof query[key] === 'number' ? String(query[key]) : str(key);
    return /^\d+$/.test(text) &&
      Number.isSafeInteger(Number(text)) &&
      Number(text) >= minimum &&
      Number(text) <= maximum
      ? String(Number(text))
      : '';
  };
  const filters: ProblemFilters = {
    q: str('q'),
    source: choice('source', ['all', 'cf', 'atcoder'], 'all'),
    tag: str('tag', 100),
    reason: str('reason', 100),
    status: choice('status', ['pending', 'reviewing', 'mastered']),
    solved: choice('solved', ['yes', 'no']),
    ignored: choice('ignored', ['yes', 'no'], 'no'),
    min: number('min', 0, 10000),
    max: number('max', 0, 10000),
    due: choice('due', ['yes']),
    contestId: number('contestId', 1, 1000000000),
  };
  if (filters.min && filters.max && Number(filters.min) > Number(filters.max))
    [filters.min, filters.max] = [filters.max, filters.min];
  return { filters, page: Number(number('page', 1, 1000000) || 1) };
}
export function serializeProblemFilters(filters: ProblemFilters, page = 1) {
  const normalized = parseProblemFilters({ ...filters, page: String(page) });
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(normalized.filters))
    if (value !== defaultProblemFilters[key as keyof ProblemFilters]) query[key] = value;
  if (normalized.page > 1) query.page = String(normalized.page);
  return query;
}
export function problemReturnLocation(value: unknown) {
  if (typeof value !== 'string' || !/^\/problems(?:\?|$)/.test(value)) return '/problems';
  const parsed = parseProblemFilters(Object.fromEntries(new URLSearchParams(value.split('?')[1] ?? '')));
  const query = new URLSearchParams(serializeProblemFilters(parsed.filters, parsed.page)).toString();
  return '/problems' + (query ? '?' + query : '');
}
