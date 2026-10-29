export interface KnowledgeReading {
  favorites: string[];
  recent: string[];
}

export interface ReadingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const emptyReading = (): KnowledgeReading => ({ favorites: [], recent: [] });
const storageUnavailable = '浏览器暂时无法保存阅读记录，本次收藏与最近阅读仅在当前页面保留。';
export const knowledgeReadingKey = (owner: string) =>
  'contest-review:knowledge-reading:v1:' + encodeURIComponent(owner);

/** Keep only currently available knowledge IDs; never trust persisted browser data. */
export function normalizeKnowledgeReading(value: unknown, validIds: readonly string[]): KnowledgeReading {
  if (!value || typeof value !== 'object') return emptyReading();
  const data = value as Partial<KnowledgeReading>;
  const allowed = new Set(validIds);
  const ids = (input: unknown, limit: number) =>
    Array.isArray(input)
      ? [...new Set(input.filter((id): id is string => typeof id === 'string' && allowed.has(id)))].slice(
          0,
          limit,
        )
      : [];
  return { favorites: ids(data.favorites, allowed.size), recent: ids(data.recent, 6) };
}

export function readKnowledgeReading(
  owner: string,
  validIds: readonly string[],
  storage?: ReadingStorage,
): { value: KnowledgeReading; warning: string } {
  let raw: string | null;
  try {
    if (!storage) throw new Error('Storage unavailable');
    raw = storage.getItem(knowledgeReadingKey(owner));
  } catch {
    return { value: emptyReading(), warning: storageUnavailable };
  }
  if (!raw) return { value: emptyReading(), warning: '' };
  try {
    if (raw.length > 64000) throw new Error('Invalid reading data');
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('favorites' in parsed) ||
      !Array.isArray(parsed.favorites) ||
      !('recent' in parsed) ||
      !Array.isArray(parsed.recent)
    )
      throw new Error('Invalid reading data');
    return { value: normalizeKnowledgeReading(parsed, validIds), warning: '' };
  } catch {
    return { value: emptyReading(), warning: '本浏览器的阅读记录无法识别，已使用空书架。' };
  }
}

export function writeKnowledgeReading(
  owner: string,
  value: KnowledgeReading,
  validIds: readonly string[],
  storage?: ReadingStorage,
): string {
  try {
    if (!storage) throw new Error('Storage unavailable');
    storage.setItem(
      knowledgeReadingKey(owner),
      JSON.stringify({ version: 1, ...normalizeKnowledgeReading(value, validIds) }),
    );
    return '';
  } catch {
    return storageUnavailable;
  }
}

export function rememberKnowledgeReading(value: KnowledgeReading, id: string): KnowledgeReading {
  return { ...value, recent: [id, ...value.recent.filter((entry) => entry !== id)].slice(0, 6) };
}

export function toggleKnowledgeFavorite(value: KnowledgeReading, id: string): KnowledgeReading {
  return {
    ...value,
    favorites: value.favorites.includes(id)
      ? value.favorites.filter((entry) => entry !== id)
      : [...value.favorites, id],
  };
}
