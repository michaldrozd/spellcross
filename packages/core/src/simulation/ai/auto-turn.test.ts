import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from '../systems/turn-processor.js';
import { decideNextAIAction } from './baseline-ai.js';

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

  it('eventually engages and eliminates the enemy over repeated auto turns', () => {
    const state = createBattleState(spec);
    let anyDamage = false;
    let turns = 0;
    for (let i = 0; i < 25; i += 1) {
      turns += 1;
      autoPlayerTurn(state);
      const enemiesAlive = Array.from(state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
      if (Array.from(state.sides.otherSide.units.values()).some((u) => u.currentHealth < u.stats.maxHealth || u.stance === 'destroyed')) anyDamage = true;
      if (enemiesAlive.length === 0) break;
    }
    const enemiesAlive = Array.from(state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
    expect(anyDamage).toBe(true); // the squad actually shot the enemy
    expect(enemiesAlive.length).toBe(0); // and wiped them out within 25 auto turns
  });
});
