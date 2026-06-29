import type { UnitInstance } from '@spellcross/core';
import React from 'react';

interface Props {
  unit?: UnitInstance;
  onOverwatch: () => void;
}

export const OverwatchButton: React.FC<Props> = ({ unit, onOverwatch }) => {
  // Mirror the engine's overwatch guard (turn-processor): needs 2 AP, ammo, and a ready stance.
  const noAmmo = !!unit && unit.currentAmmo !== Infinity && unit.currentAmmo <= 0;
  const suppressed = !!unit && (unit.stance === 'suppressed' || unit.stance === 'routed');
  const disabled = !unit || unit.actionPoints < 2 || noAmmo || unit.stance !== 'ready';
  const reason = !unit ? 'Select a unit'
    : unit.actionPoints < 2 ? 'Needs 2 AP'
    : noAmmo ? 'No ammo'
    : suppressed ? 'Unit suppressed'
    : unit.stance !== 'ready' ? 'Already acted'
    : '';
  return (
    <button disabled={disabled} onClick={onOverwatch} title={reason || 'Spend 2 AP to prepare reaction fire'}>
      Overwatch
    </button>
  );
};
