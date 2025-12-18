import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const mkTile = (terrain: any, passable = true) => ({
  terrain,
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable,
  providesVisionBoost: false
});

const mkUnit = (id: string, type: 'infantry' | 'vehicle' | 'air') => ({
  definition: {
    id,
    faction: 'alliance',
    name: id,
    type,
    stats: {
      maxHealth: 10,
      mobility: 3,
      vision: 3,
      armor: 0,
      morale: 50,
      weaponRanges: { w: 1 },
      weaponPower: { w: 1 },
      weaponAccuracy: { w: 1 }
    }
  },
  coordinate: { q: 0, r: 0 }
});

describe('Terrain restrictions', () => {
  it('forest only infantry; water only air', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [mkTile('forest'), mkTile('water')] };

    const infantryState = createBattleState({
      map,
      sides: [{ faction: 'alliance', units: [mkUnit('inf', 'infantry')] }, { faction: 'otherSide', units: [] }]
    });
    const infTp = new TurnProcessor(infantryState);
    const infId = Array.from(infantryState.sides.alliance.units.keys())[0];
    const infantryMove = infTp.moveUnit({ unitId: infId, path: [{ q: 1, r: 0 }] });
    expect(infantryMove.success).toBe(false);

    const vehicleState = createBattleState({
      map,
      sides: [{ faction: 'alliance', units: [mkUnit('veh', 'vehicle')] }, { faction: 'otherSide', units: [] }]
    });
    const vehTp = new TurnProcessor(vehicleState);
    const vehId = Array.from(vehicleState.sides.alliance.units.keys())[0];
    const vehicleMove = vehTp.moveUnit({ unitId: vehId, path: [{ q: 1, r: 0 }] });
    expect(vehicleMove.success).toBe(false);

    const airState = createBattleState({
      map,
      sides: [{ faction: 'alliance', units: [mkUnit('air', 'air')] }, { faction: 'otherSide', units: [] }]
    });
    const airTp = new TurnProcessor(airState);
    const airId = Array.from(airState.sides.alliance.units.keys())[0];
    const airMove = airTp.moveUnit({ unitId: airId, path: [{ q: 1, r: 0 }] });
    expect(airMove.success).toBe(true);
  });
});
