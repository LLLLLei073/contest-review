import { z } from 'zod';
import { cardSchema, type ExperienceCard } from '../shared/learning-domain';

const draftSchema = z
  .object({
    version: z.literal(1),
    base: cardSchema,
    card: cardSchema.extend({ title: z.string().max(300) }),
  })
  .refine(
    ({ base, card }) =>
      base.id === card.id && base.problemKey === card.problemKey && base.sourceId === card.sourceId,
  );
export type ExperienceDraft = z.infer<typeof draftSchema>;
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StorageAccess = () => DraftStorage;

const key = (owner: string, id: string) =>
  'contest-review:knowledge-draft:v1:' + encodeURIComponent(owner) + ':' + encodeURIComponent(id);

/** Compare editable fields and provenance, ignoring derived UI flags and timestamps. */
export function experienceRevision(card: ExperienceCard): string {
  return JSON.stringify([
    card.id,
    card.problemKey,
    card.sourceId ?? null,
    card.sourceHash,
    card.title,
    card.content,
    [...card.knowledgeIds].sort(),
    card.confirmed,
  ]);
}

export function readExperienceDraft(
  storage: StorageAccess,
  owner: string,
  id: string,
): { draft?: ExperienceDraft; error?: string } {
  try {
    const value = storage().getItem(key(owner, id));
    if (!value) return {};
    const parsed = draftSchema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.card.id !== id)
      return { error: '本地编辑记录无法识别，已保留原记录；请核对当前经验卡后再编辑。' };
    return { draft: parsed.data };
  } catch {
    return { error: '无法读取本浏览器的编辑记录，请在离开页面前保存经验卡。' };
  }
}

export function writeExperienceDraft(storage: StorageAccess, owner: string, draft: ExperienceDraft): string {
  try {
    const value = draftSchema.parse(draft);
    storage().setItem(key(owner, value.card.id), JSON.stringify(value));
    return '';
  } catch {
    return '本地暂存失败，编辑仍保留在本页；请保存经验卡后再离开或刷新。';
  }
}

export function removeExperienceDraft(storage: StorageAccess, owner: string, id: string): string {
  try {
    storage().removeItem(key(owner, id));
    return '';
  } catch {
    return '无法清除本浏览器的旧编辑记录；下次打开时请核对已保存版本。';
  }
}
