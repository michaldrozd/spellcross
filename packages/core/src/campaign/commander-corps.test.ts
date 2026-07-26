import { starterBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  applyBattleOutcome,
  assignOfficer,
  createCampaign,
  getEffectiveArmyUnitDefinition,
  getFormationCommand,
  getOfficerPromotion,
  getOperationDeploymentPlan,
  hydrateCampaignState,
  promoteOfficer,
  recruitOfficer,
  retreatFromBattle,
  serializeCampaignState,
  setUnitFormation,
  startBattleForTerritory
} from './campaign.js';

const addRosterUnit = (
  state: ReturnType<typeof createCampaign>,
  id: string,
  definitionId = 'light-infantry'
) => {
  const definition = starterBundle.units.find((candidate) => candidate.id === definitionId)!;
  state.army.push({
    id,
    definitionId,
    tier: 'rookie',
    experience: 0,
    currentHealth: definition.stats.maxHealth
  });
};

describe('persistent officer corps', () => {
  it('recruits unique profiles, excludes heroes and enforces one carrier and leader per group', () => {
    const state = createCampaign(starterBundle);
    state.resources.money = 10_000;
    const profile = starterBundle.officerProfiles[0];
    const moneyBefore = state.resources.money;
    const officer = recruitOfficer(state, starterBundle, profile.id);

    expect(moneyBefore - state.resources.money).toBe(profile.recruitCost);
    expect(officer).toMatchObject({
      profileId: profile.id,
      rankId: starterBundle.officerRanks[0].id,
      service: 0,
      status: 'active'
    });
    expect(() => recruitOfficer(state, starterBundle, profile.id)).toThrow(/already recruited/i);
    expect(() => assignOfficer(state, starterBundle, officer.id, 'captain')).toThrow(/hero/i);

    assignOfficer(state, starterBundle, officer.id, 'lance-1');
    expect(officer.assignedUnitId).toBe('lance-1');
    expect(getFormationCommand(state, starterBundle, 'alpha')).toMatchObject({
      officerId: officer.id,
      capacity: 6,
      members: 6,
      overstrength: false
    });

    const second = recruitOfficer(state, starterBundle, starterBundle.officerProfiles[1].id);
    expect(() => assignOfficer(state, starterBundle, second.id, 'apc-1')).toThrow(/already has an officer/i);
    expect(() => setUnitFormation(state, 'lance-1', 'bravo')).toThrow(/carrier/i);
  });

  it('promotes through four ranks and applies the aura only when its carrier deploys', () => {
    const state = createCampaign(starterBundle);
    state.resources.money = 10_000;
    const officer = recruitOfficer(state, starterBundle, 'arden-kade');
    assignOfficer(state, starterBundle, officer.id, 'lance-1');
    const baseline = createCampaign(starterBundle);

    const baselineDefinition = getEffectiveArmyUnitDefinition(baseline, starterBundle, 'recon-1');
    const commandedDefinition = getEffectiveArmyUnitDefinition(state, starterBundle, 'recon-1');
    for (const weaponId of Object.keys(baselineDefinition.stats.weaponPower)) {
      expect(commandedDefinition.stats.weaponPower[weaponId] - baselineDefinition.stats.weaponPower[weaponId]).toBe(2);
    }

    expect(() => promoteOfficer(state, starterBundle, officer.id)).toThrow(/service/i);
    for (const rank of starterBundle.officerRanks.slice(1)) {
      officer.service = rank.requiredService;
      const quote = getOfficerPromotion(state, starterBundle, officer.id);
      expect(quote).toMatchObject({ rankId: rank.id, cost: rank.promotionCost });
      const moneyBefore = state.resources.money;
      promoteOfficer(state, starterBundle, officer.id);
      expect(officer.rankId).toBe(rank.id);
      expect(moneyBefore - state.resources.money).toBe(rank.promotionCost);
    }

    const benchedState = hydrateCampaignState(starterBundle, serializeCampaignState(state));
    const led = startBattleForTerritory(state, starterBundle, 'sector-paris', ['captain', 'lance-1', 'recon-1']);
    const ledRecon = led.state.sides.alliance.units.get(led.deployment['recon-1'])!;
    const benched = startBattleForTerritory(benchedState, starterBundle, 'sector-paris', ['captain', 'recon-1']);
    const benchedRecon = benched.state.sides.alliance.units.get(benched.deployment['recon-1'])!;

    expect(ledRecon.stats.armor - benchedRecon.stats.armor).toBe(2);
    expect(ledRecon.stats.morale - benchedRecon.stats.morale).toBe(4);
    for (const weaponId of Object.keys(ledRecon.stats.weaponPower)) {
      expect(ledRecon.stats.weaponPower[weaponId] - benchedRecon.stats.weaponPower[weaponId]).toBe(4);
    }
  });

  it('grandfathers an overstrength current snapshot and rejects only new additions', () => {
    const current = createCampaign(starterBundle);
    for (let index = 0; index < 4; index += 1) {
      addRosterUnit(current, `legacy-${index}`);
      current.formations[0].units.push(`legacy-${index}`);
    }
    const snapshot = serializeCampaignState(current);
    delete snapshot.officers;
    const restored = hydrateCampaignState(starterBundle, snapshot);
    const alpha = getFormationCommand(restored, starterBundle, 'alpha');

    expect(alpha).toMatchObject({ members: 10, capacity: 6, overstrength: true });
    expect(restored.formations[0].units).toEqual(current.formations[0].units);
    const effective = getEffectiveArmyUnitDefinition(restored, starterBundle, 'legacy-3');
    const ungrouped = hydrateCampaignState(starterBundle, snapshot);
    setUnitFormation(ungrouped, 'legacy-3');
    const withoutFormation = getEffectiveArmyUnitDefinition(ungrouped, starterBundle, 'legacy-3');
    expect(effective.stats.armor - withoutFormation.stats.armor).toBe(1);

    addRosterUnit(restored, 'new-arrival');
    expect(() => setUnitFormation(restored, 'new-arrival', 'alpha')).toThrow(/capacity/i);
    setUnitFormation(restored, 'legacy-3');
    expect(getFormationCommand(restored, starterBundle, 'alpha').members).toBe(9);
  });

  it('round-trips recruited, promoted, assigned and fallen officers while migrating an empty corps', () => {
    const state = createCampaign(starterBundle);
    state.resources.money = 10_000;
    const active = recruitOfficer(state, starterBundle, 'mirela-sorn');
    active.service = 3;
    promoteOfficer(state, starterBundle, active.id);
    promoteOfficer(state, starterBundle, active.id);
    assignOfficer(state, starterBundle, active.id, 'lance-1');
    const fallen = recruitOfficer(state, starterBundle, 'tomas-vey');
    fallen.status = 'fallen';

    const roundTrip = hydrateCampaignState(starterBundle, serializeCampaignState(state));
    expect(roundTrip.officers).toEqual(state.officers);

    const legacySnapshot = serializeCampaignState(state);
    delete legacySnapshot.officers;
    expect(hydrateCampaignState(starterBundle, legacySnapshot).officers).toEqual([]);
  });

  it('turns a destroyed carrier into a fallen officer, shock and deterministic overflow release', () => {
    const state = createCampaign(starterBundle);
    state.resources.money = 10_000;
    const officer = recruitOfficer(state, starterBundle, 'samira-kest');
    officer.service = 6;
    promoteOfficer(state, starterBundle, officer.id);
    promoteOfficer(state, starterBundle, officer.id);
    promoteOfficer(state, starterBundle, officer.id);
    assignOfficer(state, starterBundle, officer.id, 'lance-1');
    for (let index = 0; index < 3; index += 1) {
      addRosterUnit(state, `commanded-${index}`);
      setUnitFormation(state, `commanded-${index}`, 'alpha', starterBundle);
    }
    expect(getFormationCommand(state, starterBundle, 'alpha').members).toBe(9);

    const battle = startBattleForTerritory(
      state,
      starterBundle,
      'sector-paris',
      ['captain', 'lance-1', 'recon-1', 'apc-1', 'medic-1', 'commanded-0', 'commanded-1', 'commanded-2']
    );
    const carrier = battle.state.sides.alliance.units.get(battle.deployment['lance-1'])!;
    carrier.stance = 'destroyed';
    carrier.currentHealth = 0;
    applyBattleOutcome(state, starterBundle, 'victory');

    expect(officer).toMatchObject({ status: 'fallen', assignedUnitId: undefined });
    expect(state.army.some((unit) => unit.id === 'lance-1')).toBe(false);
    const alpha = getFormationCommand(state, starterBundle, 'alpha');
    expect(alpha).toMatchObject({
      members: 6,
      capacity: 6,
      shockMoralePenalty: 8,
      officerId: undefined
    });
    expect(state.formations[0].units).toEqual([
      'captain',
      'lance-2',
      'recon-1',
      'apc-1',
      'medic-1',
      'commanded-0'
    ]);
    expect(state.log.some((entry) => entry.key === 'officerLost')).toBe(true);
    expect(state.popups?.some((popup) => popup.key === 'officerLost')).toBe(true);
  });

  it('never awards service for retreat and loses the officer with a cut-off carrier', () => {
    const safe = createCampaign(starterBundle);
    safe.resources.money = 10_000;
    const safeOfficer = recruitOfficer(safe, starterBundle, 'anika-rell');
    assignOfficer(safe, starterBundle, safeOfficer.id, 'lance-1');
    startBattleForTerritory(safe, starterBundle, 'sector-paris', ['captain', 'lance-1']);
    retreatFromBattle(safe, starterBundle);
    expect(safeOfficer).toMatchObject({ status: 'active', service: 0 });

    const cutOff = createCampaign(starterBundle);
    cutOff.resources.money = 10_000;
    const lostOfficer = recruitOfficer(cutOff, starterBundle, 'elias-dorn');
    assignOfficer(cutOff, starterBundle, lostOfficer.id, 'lance-1');
    const battle = startBattleForTerritory(cutOff, starterBundle, 'sector-paris', ['captain', 'lance-1']);
    battle.state.sides.alliance.units.get(battle.deployment['lance-1'])!.coordinate = {
      q: battle.state.map.width - 1,
      r: 0
    };
    retreatFromBattle(cutOff, starterBundle);
    expect(lostOfficer).toMatchObject({ status: 'fallen', service: 0 });
    expect(cutOff.formations.flatMap((formation) => formation.units)).not.toContain('lance-1');
  });

  it('keeps the campaign playable after all six profiles have fallen', () => {
    const state = createCampaign(starterBundle);
    state.officers = starterBundle.officerProfiles.map((profile) => ({
      id: profile.id,
      profileId: profile.id,
      rankId: starterBundle.officerRanks[0].id,
      service: 0,
      status: 'fallen' as const
    }));
    const plan = getOperationDeploymentPlan(state, starterBundle, 'sector-paris');
    expect(plan.requiredUnitIds).toContain('captain');
    expect(() => startBattleForTerritory(state, starterBundle, 'sector-paris', ['captain', 'lance-1']))
      .not.toThrow();
  });

  it('covers every formation, profile and rank through the real projection pipeline', () => {
    for (const formationId of ['alpha', 'bravo', 'charlie']) {
      for (const profile of starterBundle.officerProfiles) {
        for (const rank of starterBundle.officerRanks) {
          const state = createCampaign(starterBundle);
          const outsideUnitId = formationId === 'alpha' ? 'lance-2' : 'lance-1';
          let carrierId = 'lance-1';
          if (formationId === 'alpha') {
            setUnitFormation(state, outsideUnitId, 'bravo', starterBundle);
          } else {
            setUnitFormation(state, 'lance-1');
            setUnitFormation(state, 'recon-1', formationId);
            carrierId = 'recon-1';
          }
          const baseline = hydrateCampaignState(starterBundle, serializeCampaignState(state));
          state.officers = [{
            id: profile.id,
            profileId: profile.id,
            rankId: rank.id,
            service: rank.requiredService,
            status: 'active',
            assignedUnitId: carrierId
          }];
          const command = getFormationCommand(state, starterBundle, formationId);
          expect(command.capacity).toBe(rank.capacity);
          expect(command.bonus.attack).toBe(command.baseBonus.attack + profile.bonus.attack + rank.bonus.attack);
          expect(command.bonus.defense).toBe(command.baseBonus.defense + profile.bonus.defense + rank.bonus.defense);
          expect(command.bonus.morale).toBe(command.baseBonus.morale + profile.bonus.morale + rank.bonus.morale);

          const commanded = getEffectiveArmyUnitDefinition(state, starterBundle, carrierId);
          const baselineCommanded = getEffectiveArmyUnitDefinition(baseline, starterBundle, carrierId);
          expect(commanded.stats.armor - baselineCommanded.stats.armor).toBe(
            profile.bonus.defense + rank.bonus.defense
          );
          expect(commanded.stats.morale - baselineCommanded.stats.morale).toBe(
            profile.bonus.morale + rank.bonus.morale
          );
          for (const weaponId of Object.keys(commanded.stats.weaponPower)) {
            expect(commanded.stats.weaponPower[weaponId] - baselineCommanded.stats.weaponPower[weaponId]).toBe(
              profile.bonus.attack + rank.bonus.attack
            );
          }

          expect(getEffectiveArmyUnitDefinition(state, starterBundle, outsideUnitId)).toEqual(
            getEffectiveArmyUnitDefinition(baseline, starterBundle, outsideUnitId)
          );
        }
      }
    }
  });

  it('pins the fully stacked elite offensive and morale ceilings', () => {
    const state = createCampaign(starterBundle);
    addRosterUnit(state, 'ceiling-unit', 'siege-walker');
    const unit = state.army.find((candidate) => candidate.id === 'ceiling-unit')!;
    unit.tier = 'elite';
    unit.equipment = {
      offense: 'hammerburst-feed',
      protection: 'lattice-plate',
      mobility: 'sprint-governor'
    };
    state.research.completed = new Set(starterBundle.research.map((topic) => topic.id));
    setUnitFormation(state, 'ceiling-unit', 'charlie', starterBundle);
    const rank = starterBundle.officerRanks.at(-1)!;
    state.officers = [{
      id: 'arden-kade',
      profileId: 'arden-kade',
      rankId: rank.id,
      service: rank.requiredService,
      status: 'active',
      assignedUnitId: unit.id
    }];

    const projected = getEffectiveArmyUnitDefinition(state, starterBundle, unit.id);
    expect(projected.stats).toMatchObject({
      maxHealth: 200,
      mobility: 6,
      vision: 5,
      armor: 18,
      morale: 96,
      ammoCapacity: 6,
      weaponRanges: { siegecannon: 8, flak: 4 },
      weaponPower: { siegecannon: 50, flak: 24 }
    });
    expect(projected.stats.weaponAccuracy.siegecannon).toBeCloseTo(0.76);
    expect(projected.stats.weaponAccuracy.flak).toBeCloseTo(0.7);

    const moraleState = createCampaign(starterBundle);
    addRosterUnit(moraleState, 'morale-ceiling-unit', 'kestrel-recon-drone');
    const moraleUnit = moraleState.army.find((candidate) => candidate.id === 'morale-ceiling-unit')!;
    moraleUnit.tier = 'elite';
    moraleUnit.equipment = { protection: 'impact-cradle' };
    moraleState.research.completed = new Set(starterBundle.research.map((topic) => topic.id));
    setUnitFormation(moraleState, moraleUnit.id, 'bravo', starterBundle);
    moraleState.officers = [{
      id: 'tomas-vey',
      profileId: 'tomas-vey',
      rankId: rank.id,
      service: rank.requiredService,
      status: 'active',
      assignedUnitId: moraleUnit.id
    }];

    const moraleProjected = getEffectiveArmyUnitDefinition(moraleState, starterBundle, moraleUnit.id);
    expect(moraleProjected.stats.morale).toBe(136);
  });
});
