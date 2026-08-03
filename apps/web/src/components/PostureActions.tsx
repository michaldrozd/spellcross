import { canDigIn, canRally, entrenchmentCap, isDeployableSensor } from '@spellcross/core';
import type { TacticalBattleState, UnitInstance } from '@spellcross/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  battleState: TacticalBattleState;
  unit: UnitInstance;
  onDigIn: () => void;
  onRally: () => void;
  onSetSensorDeployment: (deployed: boolean) => void;
}

export const PostureActions: React.FC<Props> = ({ battleState, unit, onDigIn, onRally, onSetSensorDeployment }) => {
  const { t } = useTranslation('actions');
  const digInDisabled = !canDigIn(unit);
  const rallyDisabled = !canRally(battleState, unit);
  const deployableSensor = isDeployableSensor(unit);
  const sensorDisabled = unit.actionPoints <= 0
    || unit.stance === 'destroyed'
    || unit.stance === 'routed'
    || Boolean(unit.embarkedOn)
    || (!unit.sensorDeployed && Boolean(unit.movedThisRound));

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
      {deployableSensor && (
        <button
          className="sm-btn posture-action sensor-action"
          disabled={sensorDisabled}
          aria-pressed={Boolean(unit.sensorDeployed)}
          onClick={() => onSetSensorDeployment(!unit.sensorDeployed)}
          title={sensorDisabled
            ? unit.movedThisRound && !unit.sensorDeployed
              ? t('sensor.reasonMoved')
              : unit.actionPoints <= 0
                ? t('sensor.reasonNeedsAp')
                : t('sensor.reasonUnavailable')
            : unit.sensorDeployed ? t('sensor.packTooltip') : t('sensor.deployTooltip')}
        >
          {unit.sensorDeployed ? t('sensor.packLabel') : t('sensor.deployLabel')}
        </button>
      )}
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
