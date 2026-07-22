import { canDigIn, canRally, entrenchmentCap } from '@spellcross/core';
import type { TacticalBattleState, UnitInstance } from '@spellcross/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  battleState: TacticalBattleState;
  unit: UnitInstance;
  onDigIn: () => void;
  onRally: () => void;
}

export const PostureActions: React.FC<Props> = ({ battleState, unit, onDigIn, onRally }) => {
  const { t } = useTranslation('actions');
  const digInDisabled = !canDigIn(unit);
  const rallyDisabled = !canRally(battleState, unit);

  const digInReason = unit.unitType === 'air'
    ? t('digIn.reasonAir')
    : unit.stance === 'routed'
      ? t('digIn.reasonRouted')
      : unit.movedThisRound
        ? t('digIn.reasonMoved')
        : (unit.entrench ?? 0) >= entrenchmentCap(unit)
          ? t('digIn.reasonFull')
          : unit.actionPoints <= 0
            ? t('digIn.reasonNeedsAp')
            : '';
  const rallyReason = !rallyDisabled
    ? ''
    : unit.stance !== 'suppressed' && unit.stance !== 'routed'
      ? t('rally.reasonSteady')
      : unit.actionPoints <= 0
        ? t('rally.reasonNeedsAp')
        : t('rally.reasonEnemyClose');

  return (
    <>
      <button
        className="sm-btn posture-action"
        disabled={digInDisabled}
        onClick={onDigIn}
        title={digInReason || t('digIn.tooltip')}
      >
        {t('digIn.label')}
      </button>
      <button
        className="sm-btn posture-action"
        disabled={rallyDisabled}
        onClick={onRally}
        title={rallyReason || t('rally.tooltip')}
      >
        {t('rally.label')}
      </button>
    </>
  );
};
