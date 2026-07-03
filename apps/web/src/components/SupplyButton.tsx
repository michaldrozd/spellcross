import { isSupplyUnit } from '@spellcross/core';
import type { UnitInstance } from '@spellcross/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  unit?: UnitInstance;
  hasTarget: boolean;
  onSupply: () => void;
}

// Only shown for a supply unit (support type carrying no ammo of its own). Refills an adjacent
// friendly unit's ammo to full for 2 AP.
export const SupplyButton: React.FC<Props> = ({ unit, hasTarget, onSupply }) => {
  const { t } = useTranslation('actions');
  if (!unit || !isSupplyUnit(unit)) return null;
  const disabled = !hasTarget || unit.actionPoints < 2;
  const reason = unit.actionPoints < 2 ? t('supply.reasonNeedsAp') : !hasTarget ? t('supply.reasonNoAdjacentAlly') : '';
  return (
    <button disabled={disabled} onClick={onSupply} title={reason || t('supply.tooltip')}>
      {t('supply.label')}
    </button>
  );
};
