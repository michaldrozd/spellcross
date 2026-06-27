import type { ActiveBattle } from '@spellcross/core';
import { isObjectiveMet } from '@spellcross/core';
import type { TacticalObjective } from '@spellcross/data';
import React from 'react';

interface Props {
  battle: ActiveBattle;
}

function statusLine(objective: TacticalObjective, battle: ActiveBattle, met: boolean): string {
  switch (objective.kind) {
    case 'eliminate': {
      const total = battle.scenario.otherSideForces.length;
      const surviving = Array.from(battle.state.sides.otherSide.units.values()).filter(
        (u) => u.stance !== 'destroyed'
      ).length;
      return `Enemies ${surviving}/${total}`;
    }
    case 'hold': {
      const limit = objective.turnLimit ?? 1;
      const held = battle.holdProgress[objective.id] ?? 0;
      return `Held ${Math.min(held, limit)}/${limit}`;
    }
    case 'reach':
      return met ? 'Reached' : objective.turnLimit ? `By turn ${objective.turnLimit}` : 'Not reached';
    case 'protect':
      return met ? 'Protected' : 'Lost';
    default:
      return '';
  }
}

export const ObjectiveHud: React.FC<Props> = ({ battle }) => {
  const objectives = battle.scenario.objectives;
  if (!objectives?.length) return null;
  return (
    <div className="objective-hud">
      <h3>Objectives</h3>
      <ul>
        {objectives.map((objective) => {
          const met = isObjectiveMet(objective, battle);
          const failed = objective.kind === 'protect' && !met;
          return (
            <li key={objective.id} className={met ? 'met' : failed ? 'failed' : ''}>
              <span className="obj-dot">{met ? '✓' : failed ? '✕' : '○'}</span>
              <span className="obj-text">{objective.description}</span>
              <span className="obj-status">{statusLine(objective, battle, met)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
