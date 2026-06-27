import type { UnitInstance } from '@spellcross/core';
import React from 'react';

interface Props {
  unit?: UnitInstance;
  onOverwatch: () => void;
}

export const OverwatchButton: React.FC<Props> = ({ unit, onOverwatch }) => {
  const disabled = !unit || unit.actionPoints < 2 || unit.stance !== 'ready';
  const reason = !unit ? 'Select a unit' : unit.actionPoints < 2 ? 'Needs 2 AP' : unit.stance !== 'ready' ? 'Already acted' : '';
  return (
    <button disabled={disabled} onClick={onOverwatch} title={reason || 'Spend 2 AP to prepare reaction fire'}>
      Overwatch
    </button>
  );
};
