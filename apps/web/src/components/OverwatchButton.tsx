import type { UnitInstance } from '@spellcross/core';
import React from 'react';

interface Props {
  unit?: UnitInstance;
  onOverwatch: () => void;
}

export const OverwatchButton: React.FC<Props> = ({ unit, onOverwatch }) => {
  const disabled = !unit || unit.actionPoints < 2 || unit.stance !== 'ready';
  return (
    <button disabled={disabled} onClick={onOverwatch} title="Spend 2 AP to prepare reaction fire">
      Overwatch
    </button>
  );
};
