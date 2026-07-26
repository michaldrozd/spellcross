import type { ActiveBattle } from '@spellcross/core';
import { checkObjectiveAction, isObjectiveDeadlineMissed, isObjectiveMet } from '@spellcross/core';
import type { TacticalObjective } from '@spellcross/data';
import type { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '../i18n/index.js';

interface Props {
  battle: ActiveBattle;
  selectedUnitId?: string;
  onObjectiveAction: (objectiveId: string) => void;
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
    case 'interact':
      if (met) return t('objective.completed');
      if (isObjectiveDeadlineMissed(objective, battle)) return t('objective.deadlineMissed');
      return objective.deadlineRound
        ? t('objective.actionByRound', { limit: objective.deadlineRound })
        : t('objective.pendingAction');
    default:
      return '';
  }
}

export const ObjectiveHud: React.FC<Props> = ({ battle, selectedUnitId, onObjectiveAction }) => {
  const { t } = useTranslation('actions');
  const { t: errorText } = useTranslation('errors');
  const objectives = battle.scenario.objectives;
  if (!objectives?.length) return null;
  return (
    <div className="objective-hud">
      <h3>{t('objective.heading')}</h3>
      <ul>
        {objectives.map((objective) => {
          const met = isObjectiveMet(objective, battle);
          const failed = (objective.kind === 'protect' && !met)
            || isObjectiveDeadlineMissed(objective, battle);
          const actionCheck = objective.kind === 'interact'
            ? checkObjectiveAction(battle, selectedUnitId, objective.id)
            : null;
          const actionReasonId = `objective-action-reason-${objective.id}`;
          return (
            <li key={objective.id} className={met ? 'met' : failed ? 'failed' : ''}>
              <span className="obj-dot">{met ? '✓' : failed ? '✕' : '○'}</span>
              <span className="obj-text">
                {localizedObjectiveText(battle.scenario.id, objective.id, objective.description)}
                {objective.optional ? <small className="objective-optional">{t('objective.optional')}</small> : null}
                {objective.essential ? <small className="objective-essential">{t('objective.essential')}</small> : null}
              </span>
              <span className="obj-status">{statusLine(objective, battle, met, t)}</span>
              {objective.kind === 'interact' && actionCheck && !met ? (
                <span className="objective-action-slot">
                  <button
                    className="objective-action"
                    disabled={!actionCheck.success}
                    aria-describedby={!actionCheck.success ? actionReasonId : undefined}
                    title={actionCheck.errorKey ? errorText(actionCheck.errorKey) : t(`objective.actionTooltip.${objective.actionKey}`)}
                    onClick={() => onObjectiveAction(objective.id)}
                  >
                    {t(`objective.action.${objective.actionKey}`)}
                  </button>
                  {!actionCheck.success && actionCheck.errorKey ? (
                    <small id={actionReasonId} className="objective-action-reason">
                      {errorText(actionCheck.errorKey)}
                    </small>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
