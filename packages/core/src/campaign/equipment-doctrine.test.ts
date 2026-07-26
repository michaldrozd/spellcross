import { starterBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  createCampaign,
  getEffectiveArmyUnitDefinition,
  getUnitEquipmentOptions,
  hydrateCampaignState,
  projectUnitEquipment,
  projectUnitService,
  rearmUnit,
  serializeCampaignState,
  setUnitEquipment,
  startBattleForTerritory
} from './campaign.js';

describe('persistent equipment doctrine', () => {
  const numericStats = (stats: ReturnType<typeof getEffectiveArmyUnitDefinition>['stats']) => ({
    armor: stats.armor,
    morale: stats.morale,
    mobility: stats.mobility,
    vision: stats.vision,
    ...Object.fromEntries(Object.entries(stats.weaponPower).map(([weaponId, stat]) => [`power:${weaponId}`, stat])),
    ...Object.fromEntries(Object.entries(stats.weaponRanges).map(([weaponId, stat]) => [`range:${weaponId}`, stat])),
    ...Object.fromEntries(Object.entries(stats.weaponAccuracy).map(([weaponId, stat]) => [`accuracy:${weaponId}`, stat]))
  });

  it('projects and applies one researched package per category without drifting from battle stats', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    state.resources.money = 10_000;

    const offense = projectUnitEquipment(state, starterBundle, unit.id, 'offense', 'helix-sight-bus');
    expect(offense.cost).toBe(55);
    expect(offense.before.mobility - offense.after.mobility).toBe(1);
    expect(offense.after.vision - offense.before.vision).toBe(1);
    for (const weaponId of Object.keys(offense.before.weaponAccuracy)) {
      expect(offense.after.weaponAccuracy[weaponId] - offense.before.weaponAccuracy[weaponId]).toBeCloseTo(0.04);
    }

    const moneyBefore = state.resources.money;
    setUnitEquipment(state, starterBundle, unit.id, 'offense', 'helix-sight-bus');
    setUnitEquipment(state, starterBundle, unit.id, 'protection', 'signal-veil');
    setUnitEquipment(state, starterBundle, unit.id, 'mobility', 'trailblazer-drive');
    expect(unit.equipment).toEqual({
      offense: 'helix-sight-bus',
      protection: 'signal-veil',
      mobility: 'trailblazer-drive'
    });
    expect(moneyBefore - state.resources.money).toBe(165);

    const effective = getEffectiveArmyUnitDefinition(state, starterBundle, unit.id);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris', ['captain', unit.id]);
    const deployed = battle.state.sides.alliance.units.get(battle.deployment[unit.id])!;
    expect(deployed.stats).toEqual(effective.stats);
  });

  it('shows the delivered accuracy at the cap instead of the nominal package bonus', () => {
    const state = createCampaign(starterBundle);
    state.army.push({
      id: 'cap-test',
      definitionId: 'breach-engineers',
      tier: 'elite',
      experience: 60,
      currentHealth: 90,
      equipment: {}
    });
    state.formations[0].units.push('cap-test');

    const quote = projectUnitEquipment(state, starterBundle, 'cap-test', 'offense', 'helix-sight-bus');
    expect(quote.before.weaponAccuracy['demolition-charge']).toBe(0.98);
    expect(quote.after.weaponAccuracy['demolition-charge']).toBe(0.98);
    expect(quote.after.vision - quote.before.vision).toBe(1);
    expect(quote.after.mobility - quote.before.mobility).toBe(-1);
  });

  it('delivers a real benefit and downside for every offered roster pairing', () => {
    const state = createCampaign(starterBundle);
    state.research.completed = new Set(starterBundle.research.map((topic) => topic.id));
    state.formations = [];

    for (const definition of starterBundle.units.filter((candidate) => candidate.faction === 'alliance')) {
      state.army = [{
        id: `matrix-${definition.id}`,
        definitionId: definition.id,
        tier: 'rookie',
        experience: 0,
        currentHealth: definition.stats.maxHealth,
        equipment: {}
      }];
      const options = getUnitEquipmentOptions(state, starterBundle, state.army[0].id);
      if (definition.type === 'hero') {
        expect(options, definition.id).toEqual([]);
        continue;
      }
      expect(options, definition.id).toHaveLength(
        Object.keys(definition.stats.weaponPower).length > 0 ? 12 : 8
      );
      for (const option of options) {
        const quote = projectUnitEquipment(
          state,
          starterBundle,
          state.army[0].id,
          option.equipment.category,
          option.equipment.id
        );
        const before = numericStats(quote.before);
        const after = numericStats(quote.after);
        const deltas = Object.keys(before).map((stat) => after[stat] - before[stat]);
        expect(deltas.some((delta) => delta > 0), `${definition.id}:${option.equipment.id} benefit`).toBe(true);
        expect(deltas.some((delta) => delta < 0), `${definition.id}:${option.equipment.id} downside`).toBe(true);
      }
    }
  });

  it('enforces research, category, affordability and combat-capable eligibility', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    const hero = state.army.find((candidate) => candidate.id === 'captain')!;
    state.army.push({
      id: 'truck-test',
      definitionId: 'supply-truck',
      tier: 'rookie',
      experience: 0,
      currentHealth: 75
    });

    const startingOptions = getUnitEquipmentOptions(state, starterBundle, unit.id);
    expect(startingOptions).toHaveLength(starterBundle.equipment.length);
    for (const category of ['offense', 'protection', 'mobility'] as const) {
      expect(startingOptions.filter((option) => (
        option.equipment.category === category && option.unlocked
      ))).toHaveLength(1);
    }
    expect(() => projectUnitEquipment(
      state, starterBundle, unit.id, 'offense', 'hammerburst-feed'
    )).toThrow(/research/i);
    expect(() => projectUnitEquipment(
      state, starterBundle, unit.id, 'protection', 'helix-sight-bus'
    )).toThrow(/category/i);
    expect(getUnitEquipmentOptions(state, starterBundle, hero.id)).toEqual([]);
    const truckOptions = getUnitEquipmentOptions(state, starterBundle, 'truck-test');
    expect(truckOptions).toHaveLength(8);
    expect(truckOptions.some((option) => option.equipment.category === 'offense')).toBe(false);
    expect(truckOptions.some((option) => option.equipment.category === 'protection')).toBe(true);
    expect(truckOptions.some((option) => option.equipment.category === 'mobility')).toBe(true);
    expect(() => projectUnitEquipment(
      state, starterBundle, 'truck-test', 'offense', 'helix-sight-bus'
    )).toThrow(/eligible/i);

    state.resources.money = 0;
    expect(() => setUnitEquipment(
      state, starterBundle, unit.id, 'offense', 'helix-sight-bus'
    )).toThrow(/money/i);
    expect(unit.equipment).toEqual({});
  });

  it('replaces only one slot and returns it to standard issue for free', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    state.resources.money = 10_000;
    state.research.completed.add('optics-ii');

    setUnitEquipment(state, starterBundle, unit.id, 'offense', 'helix-sight-bus');
    setUnitEquipment(state, starterBundle, unit.id, 'protection', 'signal-veil');
    const replacement = projectUnitEquipment(
      state, starterBundle, unit.id, 'offense', 'vector-range-lattice'
    );
    setUnitEquipment(state, starterBundle, unit.id, 'offense', 'vector-range-lattice');
    expect(replacement.replacedEquipmentId).toBe('helix-sight-bus');
    expect(unit.equipment).toEqual({
      offense: 'vector-range-lattice',
      protection: 'signal-veil'
    });
    expect(() => setUnitEquipment(
      state, starterBundle, unit.id, 'offense', 'vector-range-lattice'
    )).toThrow(/already fitted/i);

    const moneyBeforeRemoval = state.resources.money;
    const standard = projectUnitEquipment(state, starterBundle, unit.id, 'offense');
    expect(standard.cost).toBe(0);
    setUnitEquipment(state, starterBundle, unit.id, 'offense');
    expect(state.resources.money).toBe(moneyBeforeRemoval);
    expect(unit.equipment).toEqual({ protection: 'signal-veil' });
  });

  it('makes rearm reset all fitted packages explicit in projection and execution', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    state.resources.money = 10_000;
    setUnitEquipment(state, starterBundle, unit.id, 'offense', 'helix-sight-bus');
    setUnitEquipment(state, starterBundle, unit.id, 'protection', 'signal-veil');

    const quote = projectUnitService(state, starterBundle, unit.id, {
      kind: 'rearm',
      definitionId: 'rangers'
    });
    expect(quote.equipmentResetCount).toBe(2);
    rearmUnit(state, starterBundle, unit.id, 'rangers');
    expect(unit.equipment).toEqual({});
  });

  it('migrates current-format saves without equipment and preserves fitted or unknown IDs', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    state.resources.money = 10_000;
    setUnitEquipment(state, starterBundle, unit.id, 'offense', 'helix-sight-bus');

    const fittedSnapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    const restored = hydrateCampaignState(starterBundle, fittedSnapshot);
    expect(restored.army.find((candidate) => candidate.id === unit.id)?.equipment)
      .toEqual({ offense: 'helix-sight-bus' });

    const legacySnapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    for (const savedUnit of [...legacySnapshot.army, ...legacySnapshot.reserves]) {
      delete savedUnit.equipment;
    }
    const legacy = hydrateCampaignState(starterBundle, legacySnapshot);
    expect(legacy.army.every((candidate) => candidate.equipment != null)).toBe(true);
    expect(legacy.army.find((candidate) => candidate.id === unit.id)?.equipment).toEqual({});
    expect(legacy.resources).toEqual(state.resources);
    expect(legacy.turn).toBe(state.turn);

    const unknownSnapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    unknownSnapshot.army.find((candidate: { id: string }) => candidate.id === unit.id).equipment.offense =
      'retired-package';
    const unknown = hydrateCampaignState(starterBundle, unknownSnapshot);
    expect(unknown.army.find((candidate) => candidate.id === unit.id)?.equipment)
      .toEqual({ offense: 'retired-package' });
    const unknownEffective = getEffectiveArmyUnitDefinition(unknown, starterBundle, unit.id);
    const legacyEffective = getEffectiveArmyUnitDefinition(legacy, starterBundle, unit.id);
    expect(unknownEffective.stats).toEqual(legacyEffective.stats);
  });
});
