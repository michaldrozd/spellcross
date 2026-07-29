import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { decideNextAIAction } from './baseline-ai.js';
import { TurnProcessor } from '../systems/turn-processor.js';
import { updateAllFactionsVision } from '../visibility/vision.js';

const plain = {
  terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false
} as const;

const makeMap = (w: number, h: number) => ({ id: 'm', width: w, height: h, tiles: Array.from({ length: w * h }, () => plain) });

const rifleman = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number) => ({
  definition: {
    id, faction, name: id, type: 'infantry' as const,
    stats: { maxHealth: 40, mobility: 8, vision: 6, armor: 0, morale: 60, ammoCapacity: 12,
      weaponRanges: { rifle: 4 }, weaponPower: { rifle: 14 }, weaponAccuracy: { rifle: 0.85 } }
  },
  coordinate: { q, r }
});

const armoredRanger = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number) => ({
  definition: {
    id, faction, name: id, type: 'vehicle' as const,
    stats: {
      maxHealth: 100, mobility: 8, vision: 6, armor: 8, morale: 70,
      weaponRanges: { cannon: 7, coax: 3 }, weaponPower: { cannon: 28, coax: 8 },
      weaponAccuracy: { cannon: 0.64, coax: 0.52 }
    }
  },
  coordinate: { q, r }
});

// Lightly-armed dummies: enough to be a target, not enough to grind the advancing squad down so the test
// isolates the auto-turn planner (advance + engage + clear) from reaction-fire combat balance.
const dummy = (id: string, q: number, r: number) => ({
  definition: {
    id, faction: 'otherSide' as const, name: id, type: 'infantry' as const,
    stats: { maxHealth: 12, mobility: 4, vision: 5, armor: 0, morale: 60, ammoCapacity: 12,
      weaponRanges: { pistol: 3 }, weaponPower: { pistol: 3 }, weaponAccuracy: { pistol: 0.3 } }
  },
  coordinate: { q, r }
});

// Mirrors App.runAutoPlayerTurn's targeting: the player squad is driven by the same planner the enemy
// uses, with live enemy positions (plus any reach tiles) as goals so it advances to contact.
function autoPlayerTurn(state: ReturnType<typeof createBattleState>, reachTargets: { q: number; r: number }[] = []) {
  const proc = new TurnProcessor(state, { random: () => 0 });
  const failed = new Set<string>();
  let safety = 0;
  while (state.activeFaction === 'alliance' && safety < 80) {
    safety += 1;
    const action = decideNextAIAction(state, 'alliance', {
      objectiveTargets: reachTargets, reachTargets, defendBias: false, aggression: 0.85, difficulty: 'hard', allowDemolition: false, excludeUnitIds: failed
    });
    if (action.type === 'endTurn') break;
    if (action.type === 'move') { if (!proc.moveUnit(action).success) failed.add(action.unitId); }
    else if (action.type === 'attack') { if (!proc.attackUnit(action).success) failed.add(action.attackerId); }
    else if (action.type === 'attackTile') { proc.attackTile({ attackerId: action.unitId, target: action.target, weaponId: action.weaponId }); }
    else if (action.type === 'supply') { if (!proc.supply({ supplierId: action.supplierId, targetId: action.targetId }).success) failed.add(action.supplierId); }
    else break;
  }
  proc.endTurn(); // alliance -> otherSide
  proc.endTurn(); // skip a passive enemy turn -> back to alliance
}

const minDistToEnemies = (state: ReturnType<typeof createBattleState>) => {
  const allies = Array.from(state.sides.alliance.units.values()).filter((u) => u.stance !== 'destroyed');
  const enemies = Array.from(state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
  let min = Infinity;
  for (const a of allies) for (const e of enemies) {
    const d = (Math.abs(a.coordinate.q - e.coordinate.q) + Math.abs(a.coordinate.r - e.coordinate.r) + Math.abs((a.coordinate.q + a.coordinate.r) - (e.coordinate.q + e.coordinate.r))) / 2;
    if (d < min) min = d;
  }
  return min;
};

function runComputerSide(
  state: ReturnType<typeof createBattleState>,
  processor: TurnProcessor,
  faction: 'alliance' | 'otherSide'
) {
  const enemyFaction = faction === 'alliance' ? 'otherSide' : 'alliance';
  const failed = new Set<string>();
  let decisions = 0;
  while (state.activeFaction === faction && decisions < 80) {
    decisions += 1;
    const visibleTiles = state.vision[faction].visibleTiles;
    const visibleEnemyIds = new Set(
      Array.from(state.sides[enemyFaction].units.values())
        .filter((unit) => visibleTiles.has(unit.coordinate.r * state.map.width + unit.coordinate.q))
        .map((unit) => unit.id)
    );
    const action = decideNextAIAction(state, faction, {
      aggression: 0.85,
      difficulty: 'hard',
      visibleEnemyIds,
      excludeUnitIds: failed
    });
    if (action.type === 'endTurn') return;
    if (action.type === 'move') {
      if (!processor.moveUnit(action).success) failed.add(action.unitId);
    } else if (action.type === 'attack') {
      if (!processor.attackUnit(action).success) failed.add(action.attackerId);
    }
  }
}

describe('Auto Turn (computer plays the player side)', () => {
  const spec: CreateBattleStateOptions = {
    map: makeMap(12, 3),
    sides: [
      { faction: 'alliance', units: [rifleman('ally-a', 'alliance', 0, 1), rifleman('ally-b', 'alliance', 0, 0)] },
      { faction: 'otherSide', units: [dummy('foe-a', 10, 1), dummy('foe-b', 11, 1)] }
    ]
  };

  it('advances the squad toward distant enemies instead of idling', () => {
    const state = createBattleState(spec);
    const distStart = minDistToEnemies(state);
    autoPlayerTurn(state);
    expect(minDistToEnemies(state)).toBeLessThan(distStart); // closed the gap on turn one
  });

  it('uses an exactly affordable decimal-cost advance that the executor accepts', () => {
    const decimalTile = {
      ...plain,
      movementCostModifier: 0.1
    };
    const state = createBattleState({
      map: {
        id: 'decimal-advance',
        width: 5,
        height: 1,
        tiles: Array.from({ length: 5 }, () => decimalTile)
      },
      sides: [
        { faction: 'alliance', units: [rifleman('ally', 'alliance', 0, 0)] },
        { faction: 'otherSide', units: [dummy('foe', 4, 0)] }
      ]
    });
    const ally = Array.from(state.sides.alliance.units.values())[0];
    ally.actionPoints = 0.3;

    const action = decideNextAIAction(state, 'alliance', {
      aggression: 0.85,
      difficulty: 'hard',
      visibleEnemyIds: new Set()
    });
    expect(action).toMatchObject({
      type: 'move',
      path: [
        { q: 1, r: 0 },
        { q: 2, r: 0 },
        { q: 3, r: 0 }
      ]
    });
    if (action.type !== 'move') throw new Error('expected exact-AP move');
    expect(new TurnProcessor(state).moveUnit(action).success).toBe(true);
    expect(ally.coordinate).toEqual({ q: 3, r: 0 });
    expect(ally.actionPoints).toBe(0);
  });

  it('uses an exactly affordable decimal-cost fallback step', () => {
    const decimalTile = {
      ...plain,
      movementCostModifier: 0.3
    };
    const state = createBattleState({
      map: {
        id: 'decimal-fallback',
        width: 5,
        height: 1,
        tiles: Array.from({ length: 5 }, () => decimalTile)
      },
      sides: [
        { faction: 'alliance', units: [rifleman('ally', 'alliance', 2, 0)] },
        { faction: 'otherSide', units: [dummy('foe', 3, 0)] }
      ]
    });
    const ally = Array.from(state.sides.alliance.units.values())[0];
    ally.actionPoints = 0.3;
    ally.currentHealth = 10;

    const action = decideNextAIAction(state, 'alliance', {
      aggression: 0.85,
      difficulty: 'hard',
      visibleEnemyIds: new Set()
    });
    expect(action).toMatchObject({
      type: 'move',
      path: [{ q: 1, r: 0 }]
    });
    if (action.type !== 'move') throw new Error('expected exact-AP fallback');
    expect(new TurnProcessor(state).moveUnit(action).success).toBe(true);
    expect(ally.coordinate).toEqual({ q: 1, r: 0 });
    expect(ally.actionPoints).toBe(0);
  });

  it('stops on an objective and does not route away after occupying it', () => {
    const state = createBattleState({
      map: makeMap(5, 1),
      sides: [
        { faction: 'alliance', units: [rifleman('ally', 'alliance', 0, 0)] },
        { faction: 'otherSide', units: [] }
      ]
    });
    const ally = Array.from(state.sides.alliance.units.values())[0];
    const objective = { q: 3, r: 0 };
    const options = {
      objectiveTargets: [objective],
      reachTargets: [objective],
      objectiveUnitIds: new Set([ally.id]),
      aggression: 0.85,
      difficulty: 'hard' as const,
      visibleEnemyIds: new Set<string>()
    };

    const approach = decideNextAIAction(state, 'alliance', options);
    expect(approach).toMatchObject({
      type: 'move',
      path: [
        { q: 1, r: 0 }
      ]
    });
    if (approach.type !== 'move') throw new Error('expected objective move');
    expect(new TurnProcessor(state).moveUnit(approach).success).toBe(true);
    expect(ally.coordinate).toEqual({ q: 1, r: 0 });

    ally.actionPoints = ally.maxActionPoints;
    const nextStep = decideNextAIAction(state, 'alliance', options);
    expect(nextStep).toMatchObject({
      type: 'move',
      path: [{ q: 2, r: 0 }]
    });
    if (nextStep.type !== 'move') throw new Error('expected next objective step');
    expect(new TurnProcessor(state).moveUnit(nextStep).success).toBe(true);
    ally.actionPoints = ally.maxActionPoints;
    const arrival = decideNextAIAction(state, 'alliance', options);
    if (arrival.type !== 'move') throw new Error('expected objective arrival');
    expect(new TurnProcessor(state).moveUnit(arrival).success).toBe(true);
    expect(ally.coordinate).toEqual(objective);

    const holding = decideNextAIAction(state, 'alliance', options);
    expect(holding.type).not.toBe('move');
    expect(ally.coordinate).toEqual(objective);
  });

  it('advances a named objective unit before unrelated attacks, then lets its screen engage', () => {
    const state = createBattleState({
      map: makeMap(9, 3),
      sides: [
        {
          faction: 'alliance',
          units: [
            rifleman('runner', 'alliance', 0, 0),
            rifleman('screen', 'alliance', 0, 2)
          ]
        },
        { faction: 'otherSide', units: [dummy('foe', 4, 2)] }
      ]
    });
    const runner = Array.from(state.sides.alliance.units.values())
      .find((unit) => unit.definitionId === 'runner')!;
    const screen = Array.from(state.sides.alliance.units.values())
      .find((unit) => unit.definitionId === 'screen')!;
    const foe = Array.from(state.sides.otherSide.units.values())[0];
    const objective = { q: 8, r: 0 };
    const options = {
      objectiveTargets: [objective],
      reachTargets: [objective],
      objectiveUnitIds: new Set([runner.id]),
      aggression: 0.85,
      difficulty: 'hard' as const,
      visibleEnemyIds: new Set([foe.id])
    };

    const advance = decideNextAIAction(state, 'alliance', options);
    expect(advance).toMatchObject({
      type: 'move',
      unitId: runner.id
    });
    if (advance.type !== 'move') throw new Error('expected objective advance');
    expect(new TurnProcessor(state).moveUnit(advance).success).toBe(true);
    expect(runner.actionPoints).toBeLessThan(runner.maxActionPoints);

    const engagement = decideNextAIAction(state, 'alliance', options);
    expect(engagement).toMatchObject({
      type: 'attack',
      attackerId: screen.id,
      defenderId: foe.id
    });
  });

  it('keeps attack-first behavior when no unit is designated to move', () => {
    const objective = { q: 8, r: 0 };
    const state = createBattleState({
      map: makeMap(9, 3),
      sides: [
        { faction: 'alliance', units: [rifleman('holder', 'alliance', 0, 2)] },
        { faction: 'otherSide', units: [dummy('foe', 4, 2)] }
      ]
    });
    const holder = Array.from(state.sides.alliance.units.values())[0];
    const foe = Array.from(state.sides.otherSide.units.values())[0];

    expect(decideNextAIAction(state, 'alliance', {
      objectiveTargets: [objective],
      aggression: 0.85,
      difficulty: 'hard',
      visibleEnemyIds: new Set([foe.id])
    })).toMatchObject({
      type: 'attack',
      attackerId: holder.id,
      defenderId: foe.id
    });
  });

  it('clears a visible enemy from a named objective before advancing', () => {
    const objective = { q: 4, r: 0 };
    const state = createBattleState({
      map: makeMap(7, 1),
      sides: [
        { faction: 'alliance', units: [rifleman('runner', 'alliance', 1, 0)] },
        { faction: 'otherSide', units: [dummy('occupier', objective.q, objective.r)] }
      ]
    });
    const runner = Array.from(state.sides.alliance.units.values())[0];
    const occupier = Array.from(state.sides.otherSide.units.values())[0];

    expect(decideNextAIAction(state, 'alliance', {
      objectiveTargets: [objective],
      reachTargets: [objective],
      objectiveUnitIds: new Set([runner.id]),
      aggression: 0.85,
      difficulty: 'hard',
      visibleEnemyIds: new Set([occupier.id])
    })).toMatchObject({
      type: 'attack',
      attackerId: runner.id,
      defenderId: occupier.id
    });
  });

  it('respects fog of war: never fires at an enemy outside the visible set, but does when it is visible', () => {
    const fogSpec: CreateBattleStateOptions = {
      map: makeMap(8, 3),
      sides: [
        { faction: 'alliance', units: [rifleman('ally', 'alliance', 1, 1)] }, // rifle range 4
        { faction: 'otherSide', units: [dummy('foe', 3, 1)] } // distance 2 — in range
      ]
    };
    const state = createBattleState(fogSpec);
    const foeId = Array.from(state.sides.otherSide.units.values())[0].id;

    // in range but unseen → must not attack (it advances/scouts instead)
    const hidden = decideNextAIAction(state, 'alliance', { aggression: 0.85, difficulty: 'hard', visibleEnemyIds: new Set() });
    expect(hidden.type).not.toBe('attack');

    // same position, now visible → attacks
    const seen = decideNextAIAction(state, 'alliance', { aggression: 0.85, difficulty: 'hard', visibleEnemyIds: new Set([foeId]) });
    expect(seen.type).toBe('attack');
  });

  it('eventually engages and eliminates the enemy over repeated auto turns', () => {
    const state = createBattleState(spec);
    let anyDamage = false;
    for (let i = 0; i < 25; i += 1) {
      autoPlayerTurn(state);
      const enemiesAlive = Array.from(state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
      if (Array.from(state.sides.otherSide.units.values()).some((u) => u.currentHealth < u.stats.maxHealth || u.stance === 'destroyed')) anyDamage = true;
      if (enemiesAlive.length === 0) break;
    }
    const enemiesAlive = Array.from(state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
    expect(anyDamage).toBe(true); // the squad actually shot the enemy
    expect(enemiesAlive.length).toBe(0); // and wiped them out within 25 auto turns
  });

  // A unit carrying both a long-range main gun (>=7, triggers the "artillery avoids point-blank"
  // standoff heuristic) and a genuinely short-range secondary must still use that secondary up close
  // instead of being benched by its own big gun's preference to keep distance.
  it('uses a short-range secondary weapon at point-blank range even if the unit also owns a 7+ range weapon', () => {
    const bigGunUnit = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number) => ({
      definition: {
        id, faction, name: id, type: 'vehicle' as const,
        stats: {
          maxHealth: 100, mobility: 6, vision: 6, armor: 5, morale: 70, ammoCapacity: 10,
          weaponRanges: { maingun: 7, coax: 3 }, weaponPower: { maingun: 30, coax: 8 }, weaponAccuracy: { maingun: 0.6, coax: 0.5 },
          weaponTargets: { maingun: ['vehicle', 'artillery', 'air', 'support'] } // can't hit infantry
        }
      },
      coordinate: { q, r }
    });
    const state = createBattleState({
      map: makeMap(10, 3),
      sides: [
        { faction: 'alliance', units: [bigGunUnit('tank', 'alliance', 4, 1)] },
        { faction: 'otherSide', units: [dummy('foe', 5, 1)] } // adjacent, infantry: only coax can hit it
      ]
    });
    const foeId = Array.from(state.sides.otherSide.units.values())[0].id;
    const action = decideNextAIAction(state, 'alliance', { aggression: 0.85, difficulty: 'hard', visibleEnemyIds: new Set([foeId]) });
    expect(action).toMatchObject({ type: 'attack', weaponId: 'coax' });
  });

  it('resolves a long-range armored mirror instead of stalling at the sight edge', () => {
    const state = createBattleState({
      map: makeMap(22, 3),
      sides: [
        { faction: 'alliance', units: [armoredRanger('ally-tank', 'alliance', 1, 1)] },
        { faction: 'otherSide', units: [armoredRanger('foe-tank', 'otherSide', 20, 1)] }
      ]
    });
    const processor = new TurnProcessor(state, { random: () => 0 });
    updateAllFactionsVision(state);

    for (let round = 0; round < 10; round += 1) {
      runComputerSide(state, processor, 'alliance');
      processor.endTurn();
      if (Array.from(state.sides.otherSide.units.values()).every((unit) => unit.stance === 'destroyed')) break;
      runComputerSide(state, processor, 'otherSide');
      processor.endTurn();
      if (Array.from(state.sides.alliance.units.values()).every((unit) => unit.stance === 'destroyed')) break;
    }

    const survivors = Object.values(state.sides).flatMap((side) => (
      Array.from(side.units.values()).filter((unit) => unit.stance !== 'destroyed')
    ));
    expect(survivors).toHaveLength(1);
  });
});
