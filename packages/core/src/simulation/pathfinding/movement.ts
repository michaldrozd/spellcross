import type { UnitStance } from '../types.js';

const movementPenaltyByStance: Record<UnitStance, number> = {
  ready: 1,
  suppressed: 1.3,
  routed: 1.6,
  destroyed: Number.POSITIVE_INFINITY
};

export function movementMultiplierForStance(stance: UnitStance): number {
  return movementPenaltyByStance[stance] ?? 1;
}

