import {
  createCampaign,
  startBattleForTerritory,
} from '@spellcross/core';
import { starterBundle } from '@spellcross/data';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectiveHud } from './ObjectiveHud.js';
import i18n from '../i18n/index.js';

describe('ObjectiveHud', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await i18n.changeLanguage('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('makes a critical specialist deadline and its expired state explicit', async () => {
    const campaign = createCampaign(starterBundle);
    const territory = campaign.territories.find(({ id }) => id === 'sector-mnemonic-orchard');
    if (!territory) throw new Error('missing Mnemonic Orchard');
    territory.status = 'available';
    const rosterUnit = campaign.army.find(({ availableOnTurn = 0 }) => availableOnTurn <= campaign.turn);
    if (!rosterUnit) throw new Error('expected a ready roster unit');

    const battle = startBattleForTerritory(campaign, starterBundle, territory.id, [rosterUnit.id]);
    battle.deployed = true;
    const objective = battle.scenario.objectives.find(({ essential }) => essential);
    const specialistId = objective?.unitIds?.[0];
    const specialist = specialistId
      ? battle.state.sides.alliance.units.get(battle.deployment[specialistId])
      : undefined;
    if (!objective?.target || !objective.deadlineRound || !specialist) {
      throw new Error('expected a deadline objective and its attached specialist');
    }
    specialist.coordinate = { ...objective.target };
    specialist.actionPoints = specialist.maxActionPoints;
    battle.state.round = objective.deadlineRound;

    const render = async () => {
      await act(async () => {
        root.render(
          <ObjectiveHud
            battle={battle}
            selectedUnitId={specialist.id}
            onObjectiveAction={vi.fn()}
          />
        );
      });
    };

    await render();
    expect(container.textContent).toContain('Critical');
    expect(container.textContent).toContain(`Action required by round ${objective.deadlineRound}`);
    expect(container.querySelector<HTMLButtonElement>('.objective-action')?.disabled).toBe(false);

    battle.state.round = objective.deadlineRound + 1;
    await render();
    expect(container.textContent).toContain('Deadline missed');
    expect(container.querySelector('li.failed')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('.objective-action')?.disabled).toBe(true);
    expect(container.textContent).toContain('The mission-action deadline has passed');
  });
});
