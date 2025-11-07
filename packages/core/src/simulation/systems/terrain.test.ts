import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const mkTile = (terrain: any, passable = true) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable, providesVisionBoost: false });

describe('Terrain restrictions', () => {
  it('forest only infantry; water only air', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [mkTile('forest'), mkTile('water')] };
    const base: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'inf', faction: 'alliance', name: 'I', type: 'infantry', stats: { maxHealth: 10, mobility: 3, vision: 3, armor: 0, morale: 50, weaponRanges: { w: 1 }, weaponPower: { w: 1 }, weaponAccuracy: { w: 1 } } }, coordinate: { q: 0, r: 0 } },
          { definition: { id: 'veh', faction: 'alliance', name: 'V', type: 'vehicle', stats: { maxHealth: 10, mobility: 3, vision: 3, armor: 0, morale: 50, weaponRanges: { w: 1 }, weaponPower: { w: 1 }, weaponAccuracy: { w: 1 } } }, coordinate: { q: 0, r: 0 } },
          { definition: { id: 'air', faction: 'alliance', name: 'A', type: 'air', stats: { maxHealth: 10, mobility: 3, vision: 3, armor: 0, morale: 50, weaponRanges: { w: 1 }, weaponPower: { w: 1 }, weaponAccuracy: { w: 1 } } }, coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [] }
      ]
    };

    const state = createBattleState(base);
    const ids = Array.from(state.sides.alliance.units.keys());
    const [infId, vehId, airId] = ids;
    const tp = new TurnProcessor(state);

    // infantry from forest -> water (should fail at water)
    let r = tp.moveUnit({ unitId: infId, path: [{ q: 1, r: 0 }] });
    expect(r.success).toBe(false);

    // vehicle cannot even leave forest (forest limits) -> moving to neighbor fails
    state.sides.alliance.units.get(vehId)!.coordinate = { q: 0, r: 0 };
    r = tp.moveUnit({ unitId: vehId, path: [{ q: 1, r: 0 }] });
    expect(r.success).toBe(false);

    // air can move over water
    state.sides.alliance.units.get(airId)!.coordinate = { q: 0, r: 0 };
    r = tp.moveUnit({ unitId: airId, path: [{ q: 1, r: 0 }] });
    expect(r.success).toBe(true);
  });
});

