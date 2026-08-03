import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import { planPathForUnitIso } from '../pathfinding/iso-pathfinder.js';
import type { BattlefieldMap, UnitDefinition } from '../types.js';
import { sensorVisionRange } from './sensor-deployment.js';
import { TurnProcessor } from './turn-processor.js';
import { tileIndex } from '../utils/grid.js';

const battlefield: BattlefieldMap = {
  id: 'sensor-deployment',
  width: 16,
  height: 8,
  tiles: Array.from({ length: 16 * 8 }, () => ({
    terrain: 'plain' as const,
    elevation: 0,
    cover: 0,
    movementCostModifier: 1,
    passable: true,
    providesVisionBoost: false
  }))
};

const radar: UnitDefinition = {
  id: 'horizon-radar',
  name: 'Horizon Counterbattery Radar',
  faction: 'alliance',
  type: 'support',
  stats: {
    maxHealth: 60,
    mobility: 8,
    vision: 12,
    armor: 2,
    morale: 75,
    sensorDeployment: { mobileVision: 5 },
    weaponRanges: {},
    weaponPower: {},
    weaponAccuracy: {}
  }
};

const contact: UnitDefinition = {
  id: 'contact',
  name: 'Contact',
  faction: 'otherSide',
  type: 'infantry',
  stats: {
    maxHealth: 40,
    mobility: 5,
    vision: 4,
    armor: 0,
    morale: 50,
    weaponRanges: { claw: 1 },
    weaponPower: { claw: 4 },
    weaponAccuracy: { claw: 0.6 }
  }
};

function sensorBattle() {
  return createBattleState({
    map: battlefield,
    startingFaction: 'alliance',
    sides: [
      { faction: 'alliance', units: [{ definition: radar, coordinate: { q: 2, r: 3 } }] },
      { faction: 'otherSide', units: [{ definition: contact, coordinate: { q: 13, r: 3 } }] }
    ]
  });
}

describe('deployable sensors', () => {
  it('trades a full turn and mobility for long-range vision, then packs persistently', () => {
    const state = sensorBattle();
    const radarUnit = Array.from(state.sides.alliance.units.values())[0];
    const contactUnit = Array.from(state.sides.otherSide.units.values())[0];
    const contactTile = tileIndex(state.map, contactUnit.coordinate);
    const processor = new TurnProcessor(state);

    expect(sensorVisionRange(radarUnit)).toBe(5);
    expect(state.vision.alliance.visibleTiles.has(contactTile)).toBe(false);

    expect(processor.setSensorDeployment(radarUnit.id, true).success).toBe(true);
    expect(radarUnit).toMatchObject({ sensorDeployed: true, actionPoints: 0 });
    expect(sensorVisionRange(radarUnit)).toBe(12);
    expect(state.vision.alliance.visibleTiles.has(contactTile)).toBe(true);
    expect(state.timeline.at(-1)).toMatchObject({
      kind: 'unit:sensor-mode',
      unitId: radarUnit.id,
      deployed: true
    });

    expect(planPathForUnitIso(state, radarUnit.id, { q: 3, r: 3 }))
      .toMatchObject({ success: false, reason: 'sensor_deployed' });
    expect(processor.moveUnit({ unitId: radarUnit.id, path: [{ q: 3, r: 3 }] }))
      .toMatchObject({ success: false, errorKey: 'deployedSensorCannotMove' });

    processor.endTurn();
    processor.endTurn();
    expect(radarUnit.actionPoints).toBe(radarUnit.maxActionPoints);
    expect(radarUnit.sensorDeployed).toBe(true);

    expect(processor.setSensorDeployment(radarUnit.id, false).success).toBe(true);
    expect(radarUnit).toMatchObject({ sensorDeployed: false, actionPoints: 0 });
    expect(state.vision.alliance.visibleTiles.has(contactTile)).toBe(false);

    processor.endTurn();
    processor.endTurn();
    expect(planPathForUnitIso(state, radarUnit.id, { q: 3, r: 3 }).success).toBe(true);
  });

  it('rejects deployment after moving and prevents weaponless overwatch', () => {
    const state = sensorBattle();
    const radarUnit = Array.from(state.sides.alliance.units.values())[0];
    const processor = new TurnProcessor(state);

    expect(processor.setOverwatch(radarUnit.id))
      .toMatchObject({ success: false, errorKey: 'unitCannotOverwatch' });
    expect(processor.moveUnit({ unitId: radarUnit.id, path: [{ q: 3, r: 3 }] }).success).toBe(true);
    expect(processor.setSensorDeployment(radarUnit.id, true))
      .toMatchObject({ success: false, errorKey: 'movedCannotDeploySensor' });
  });
});
