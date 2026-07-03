import type { UnitInstance } from '@spellcross/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  unit?: UnitInstance;
  hasTarget: boolean;
  onHeal: () => void;
}

// Only shown for a field medic (support unit whose id marks it as a medic). Restores HP to an
// adjacent wounded ally for 2 AP.
export const HealButton: React.FC<Props> = ({ unit, hasTarget, onHeal }) => {
  const { t } = useTranslation('actions');
  if (!unit || unit.unitType !== 'support' || !unit.definitionId.includes('medic')) return null;
  const disabled = !hasTarget || unit.actionPoints < 2;
  const reason = unit.actionPoints < 2 ? t('heal.reasonNeedsAp') : !hasTarget ? t('heal.reasonNoWoundedAdjacent') : '';
  return (
    <button disabled={disabled} onClick={onHeal} title={reason || t('heal.tooltip')}>
      {t('heal.label')}
    </button>
  );
};
