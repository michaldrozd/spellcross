import type { UnitInstance } from '@spellcross/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  unit?: UnitInstance;
  onOverwatch: () => void;
}

export const OverwatchButton: React.FC<Props> = ({ unit, onOverwatch }) => {
  const { t } = useTranslation('actions');
  // Mirror the engine's overwatch guard so disabled controls explain rejected orders.
  const noAmmo = !!unit && unit.currentAmmo !== Infinity && unit.currentAmmo <= 0;
  const noWeapon = !!unit && Object.keys(unit.stats.weaponRanges).length === 0;
  const suppressed = !!unit && (unit.stance === 'suppressed' || unit.stance === 'routed');
  const disabled = !unit || unit.actionPoints < 2 || noAmmo || noWeapon || unit.stance !== 'ready';
  const reason = !unit ? t('overwatch.reasonSelectUnit')
    : unit.actionPoints < 2 ? t('overwatch.reasonNeedsAp')
    : noAmmo ? t('overwatch.reasonNoAmmo')
    : noWeapon ? t('overwatch.reasonNoWeapon')
    : suppressed ? t('overwatch.reasonSuppressed')
    : unit.stance !== 'ready' ? t('overwatch.reasonAlreadyActed')
    : '';
  return (
    <button disabled={disabled} onClick={onOverwatch} title={reason || t('overwatch.tooltip')}>
      {t('overwatch.label')}
    </button>
  );
};
