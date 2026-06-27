import type { UnitInstance } from '@spellcross/core';
import React from 'react';

interface Props {
  unit?: UnitInstance;
  hasTarget: boolean;
  onHeal: () => void;
}

// Only shown for a field medic (support unit whose id marks it as a medic). Restores HP to an
// adjacent wounded ally for 2 AP.
export const HealButton: React.FC<Props> = ({ unit, hasTarget, onHeal }) => {
  if (!unit || unit.unitType !== 'support' || !unit.definitionId.includes('medic')) return null;
  const disabled = !hasTarget || unit.actionPoints < 2;
  const reason = unit.actionPoints < 2 ? 'Needs 2 AP' : !hasTarget ? 'No wounded ally adjacent' : '';
  return (
    <button disabled={disabled} onClick={onHeal} title={reason || 'Spend 2 AP to heal an adjacent wounded unit'}>
      Treat
    </button>
  );
};
