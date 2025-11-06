import type {
  BattlefieldMap,
  CreateBattleStateOptions,
  UnitDefinition
} from '@spellcross/core';

const mapWidth = 12;
const mapHeight = 10;

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 1,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

export const sandboxMap: BattlefieldMap = {
  id: 'tutorial-field',
  width: mapWidth,
  height: mapHeight,
  tiles: Array.from({ length: mapWidth * mapHeight }, () => ({ ...plainTile }))
};

const lightInfantry: UnitDefinition = {
  id: 'light-infantry',
  faction: 'alliance',
  name: 'Light Infantry',
  type: 'infantry',
  stats: {
    maxHealth: 100,
    mobility: 6,
    vision: 4,
    armor: 1,
    morale: 60,
    weaponRanges: { rifle: 5 },
    weaponPower: { rifle: 12 },
    weaponAccuracy: { rifle: 0.75 }
  }
};

const impRaiders: UnitDefinition = {
  id: 'imp-raiders',
  faction: 'otherSide',
  name: 'Imp Raiders',
  type: 'infantry',
  stats: {
    maxHealth: 70,
    mobility: 7,
    vision: 3,
    armor: 0.5,
    morale: 40,
    weaponRanges: { claws: 1 },
    weaponPower: { claws: 8 },
    weaponAccuracy: { claws: 0.55 }
  }
};

export const sandboxBattleSpec: CreateBattleStateOptions = {
  map: sandboxMap,
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: lightInfantry,
          coordinate: { q: 3, r: 3 }
        },
        {
          definition: lightInfantry,
          coordinate: { q: 4, r: 4 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        {
          definition: impRaiders,
          coordinate: { q: 7, r: 4 }
        }
      ]
    }
  ],
  startingFaction: 'alliance'
};
