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

export function canAffordMovementCost(
  movementCost: number,
  availableActionPoints: number,
  accumulatedSteps = 1
): boolean {
  if (availableActionPoints === Number.POSITIVE_INFINITY) return true;
  const magnitude = Math.max(
    1,
    Math.abs(movementCost),
    Math.abs(availableActionPoints)
  );
  const tolerance = Number.EPSILON
    * magnitude
    * Math.max(4, accumulatedSteps * 4);
  return movementCost - availableActionPoints <= tolerance;
}
