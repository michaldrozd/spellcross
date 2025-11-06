import { z } from 'zod';

const unitSchema = z.object({
  id: z.string(),
  name: z.string(),
  faction: z.union([z.literal('alliance'), z.literal('otherSide')]),
  type: z.string(),
  stats: z.object({
    maxHealth: z.number().int().positive(),
    mobility: z.number().int().positive(),
    vision: z.number().int().positive(),
    armor: z.number().nonnegative(),
    morale: z.number().int().positive(),
    weaponRanges: z.record(z.string(), z.number().int().nonnegative()),
    weaponPower: z.record(z.string(), z.number().nonnegative()),
    weaponAccuracy: z.record(z.string(), z.number().min(0).max(1))
  })
});

export type UnitData = z.infer<typeof unitSchema>;

export interface ContentBundle {
  units: UnitData[];
}

export function loadContentBundle(raw: unknown): ContentBundle {
  const bundleSchema = z.object({
    units: z.array(unitSchema)
  });

  const result = bundleSchema.parse(raw);
  return result;
}
