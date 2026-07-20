import type { ActiveBattle } from '@spellcross/core';
import { isObjectiveMet } from '@spellcross/core';
import type { TacticalObjective } from '@spellcross/data';
import type { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '../i18n/index.js';

interface Props {
  battle: ActiveBattle;
}

function localizedObjectiveText(scenarioId: string, objectiveId: string, fallback: string) {
  return i18n.t(`scenarios:${scenarioId}.objectives.${objectiveId}`, { defaultValue: fallback });
}

function statusLine(objective: TacticalObjective, battle: ActiveBattle, met: boolean, t: TFunction<'actions'>): string {
  switch (objective.kind) {
    case 'eliminate': {
      const total = battle.state.sides.otherSide.units.size;
      const surviving = Array.from(battle.state.sides.otherSide.units.values()).filter(
        (u) => u.stance !== 'destroyed'
      ).length;
      return t('objective.enemies', { surviving, total });
    }
    case 'hold': {
      const limit = objective.turnLimit ?? 1;
      const held = battle.holdProgress[objective.id] ?? 0;
      return t('objective.held', { held: Math.min(held, limit), limit });
    }
    case 'reach':
      return met
        ? t('objective.reached')
        : battle.reachClaimedRound?.[objective.id] != null
          ? t('objective.securing')
        : objective.turnLimit
          ? t('objective.byTurn', { limit: objective.turnLimit })
          : t('objective.notReached');
    case 'protect':
      return met ? t('objective.protected') : t('objective.lost');
    default:
      return '';
  }
}

export const ObjectiveHud: React.FC<Props> = ({ battle }) => {
  const { t } = useTranslation('actions');
  const objectives = battle.scenario.objectives;
  if (!objectives?.length) return null;
  return (
    <div className="objective-hud">
      <h3>{t('objective.heading')}</h3>
      <ul>
        {objectives.map((objective) => {
          const met = isObjectiveMet(objective, battle);
          const failed = objective.kind === 'protect' && !met;
          return (
            <li key={objective.id} className={met ? 'met' : failed ? 'failed' : ''}>
              <span className="obj-dot">{met ? '✓' : failed ? '✕' : '○'}</span>
              <span className="obj-text">{localizedObjectiveText(battle.scenario.id, objective.id, objective.description)}</span>
              <span className="obj-status">{statusLine(objective, battle, met, t)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
