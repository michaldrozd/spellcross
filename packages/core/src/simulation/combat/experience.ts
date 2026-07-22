import type { UnitInstance } from '../types.js';

// Tier promotions reward early survival; tactical levels are longer career milestones whose small
// accuracy bonus must remain meaningful without snowballing during a single operation.
export const EXPERIENCE_LEVEL_THRESHOLDS = [0, 200, 500, 900, 1400] as const;
export const MAX_EXPERIENCE_LEVEL = EXPERIENCE_LEVEL_THRESHOLDS.length;
const ACCURACY_BONUS_PER_LEVEL = 0.01;

export function experienceLevelFor(experience: number) {
  const normalized = Math.max(0, experience);
  let level = 1;
  for (let index = 1; index < EXPERIENCE_LEVEL_THRESHOLDS.length; index += 1) {
    if (normalized < EXPERIENCE_LEVEL_THRESHOLDS[index]) break;
    level = index + 1;
  }
  return level;
}

export function nextExperienceLevelThreshold(experience: number): number | undefined {
  return EXPERIENCE_LEVEL_THRESHOLDS.find((threshold) => threshold > experience);
}

export function experienceAccuracyBonus(level: number) {
  const boundedLevel = Math.max(1, Math.min(MAX_EXPERIENCE_LEVEL, level));
  return (boundedLevel - 1) * ACCURACY_BONUS_PER_LEVEL;
}

export function updateExperienceLevel(unit: UnitInstance): number[] {
  const nextLevel = experienceLevelFor(unit.experience);
  const previousLevel = Math.max(1, Math.min(MAX_EXPERIENCE_LEVEL, unit.level ?? 1));
  unit.level = nextLevel;
  if (nextLevel <= previousLevel) return [];
  return Array.from({ length: nextLevel - previousLevel }, (_, index) => previousLevel + index + 1);
}
