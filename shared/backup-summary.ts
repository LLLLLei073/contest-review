import { z } from 'zod';
const envelope = z
  .object({
    format: z.literal('contest-review'),
    version: z.number().int().min(1).max(11),
    exportedAt: z.string().optional(),
    profiles: z.array(z.string()).max(10000),
    tables: z.record(z.string(), z.array(z.unknown())),
    external: z.array(z.object({ namespace: z.string() }).passthrough()).optional(),
  })
  .passthrough();
/** Read-only inventory. Restore still validates all fields and references atomically in CoreStore. */
export function backupSummary(input: unknown) {
  const value = envelope.parse(input);
  return {
    version: value.version,
    exportedAt: value.exportedAt ?? null,
    profiles: value.profiles,
    counts: Object.entries(value.tables).map(([name, rows]) => ({ name, count: rows.length })),
    planning: value.external?.filter((r) => r.namespace.startsWith('planning:')).length ?? 0,
    workflows: value.external?.filter((r) => r.namespace.startsWith('review-workflow:')).length ?? 0,
  };
}
