import type { UnitInstance } from '@spellcross/core';
import React from 'react';

interface Props {
  unit?: UnitInstance;
  hasTarget: boolean;
  onSupply: () => void;
}

// Only shown for a supply unit (support type carrying no ammo of its own). Refills an adjacent
// friendly unit's ammo to full for 2 AP.
export const SupplyButton: React.FC<Props> = ({ unit, hasTarget, onSupply }) => {
  if (!unit || unit.unitType !== 'support' || (unit.stats.ammoCapacity ?? 0) !== 0) return null;
  const disabled = !hasTarget || unit.actionPoints < 2;
  return (
    <button disabled={disabled} onClick={onSupply} title="Spend 2 AP to refill an adjacent unit's ammo">
      Resupply
    </button>
  );
};
