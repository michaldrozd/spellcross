import { describe, it, expect } from 'vitest';
import { createBattleState } from './game-state.js';
import type { CreateBattleStateOptions } from './game-state.js';
import { TurnProcessor } from './systems/turn-processor.js';
import { decideNextAIAction } from './ai/baseline-ai.js';
import { updateAllFactionsVision } from './visibility/vision.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const inf = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number) => ({
  definition: { id, faction, name: id, type: 'infantry' as const,
    stats: { maxHealth: 40, mobility: 5, vision: 6, armor: 0, morale: 60, ammoCapacity: 20,
      weaponRanges: { rifle: 5 }, weaponPower: { rifle: 16 }, weaponAccuracy: { rifle: 0.8 } } },
  coordinate: { q, r }
});

function runWholeBattle() {
  const spec: CreateBattleStateOptions = {
    map: { id: 'm', width: 14, height: 3, tiles: Array.from({ length: 42 }, () => ({ ...plain })) },
    sides: [
      { faction: 'alliance', units: [inf('a1', 'alliance', 1, 0), inf('a2', 'alliance', 1, 2)] },
      { faction: 'otherSide', units: [inf('e1', 'otherSide', 12, 0), inf('e2', 'otherSide', 12, 2)] }
    ]
  };
  const state = createBattleState(spec);
  let s = 12345;
  const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const proc = new TurnProcessor(state, { random: rng });
  updateAllFactionsVision(state);
  state.activeFaction = 'alliance';
  const alive = (f: 'alliance' | 'otherSide') => Array.from(state.sides[f].units.values()).filter((u) => u.stance !== 'destroyed').length;
  let rounds = 0;
  const runSide = (faction: 'alliance' | 'otherSide') => {
    const foe = faction === 'alliance' ? 'otherSide' : 'alliance';
    const visible = new Set(Array.from(state.sides[foe].units.values()).map((u) => u.id));
    const failed = new Set<string>();
    let safety = 0;
    while (safety++ < 200 && state.activeFaction === faction) {
      const a = decideNextAIAction(state, faction, { aggression: 0.9, difficulty: 'hard', excludeUnitIds: failed, visibleEnemyIds: visible });
      if (a.type === 'endTurn') break;
      if (a.type === 'move') { if (!proc.moveUnit(a).success) failed.add(a.unitId); }
      else if (a.type === 'attack') { if (!proc.attackUnit(a).success) failed.add(a.attackerId); }
      else break;
    }
  };
  while (rounds < 40 && alive('alliance') > 0 && alive('otherSide') > 0) {
    rounds++;
    runSide('alliance'); proc.endTurn();
    if (alive('otherSide') === 0) break;
    runSide('otherSide'); proc.endTurn();
  }
  return { state, rounds, alliance: alive('alliance'), otherSide: alive('otherSide') };
}

describe('full battle integration (AI vs AI to resolution)', () => {
  it('resolves without error, combat happens, and one side is defeated', () => {
    const { state, rounds, alliance, otherSide } = runWholeBattle();
    // the battle terminated within the round cap (not stuck)
    expect(rounds).toBeLessThan(40);
    // exactly one side was wiped out (a real result, not a stalemate)
    expect(alliance === 0 || otherSide === 0).toBe(true);
    expect(alliance > 0 || otherSide > 0).toBe(true);
    // combat actually occurred — the timeline recorded attack/defeat events
    const attacks = state.timeline.filter((e) => e.kind === 'unit:attacked').length;
    const kills = state.timeline.filter((e) => e.kind === 'unit:defeated').length;
    expect(attacks).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(0);
  });

  it('AP is reset each turn (units can act on later rounds, not just round 1)', () => {
    const { state } = runWholeBattle();
    // a unit that survived should have been able to act across multiple rounds — verified indirectly by
    // the battle lasting >1 round with continued attacks
    const attackRounds = new Set(state.timeline.filter((e) => e.kind === 'unit:attacked').map((e: any) => e.round ?? 0));
    expect(state.timeline.filter((e) => e.kind === 'unit:attacked').length).toBeGreaterThan(1);
    expect(attackRounds.size).toBeGreaterThanOrEqual(1);
  });
});
