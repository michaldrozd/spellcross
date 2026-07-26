import type { EquipmentPackage, UnitData } from './index.js';

const FIELD_UNIT_TYPES: Array<UnitData['type']> = [
  'infantry',
  'vehicle',
  'air',
  'artillery',
  'support'
];

export const starterEquipment: EquipmentPackage[] = [
  {
    id: 'helix-sight-bus',
    name: 'Helix Sight Bus',
    description: 'Linked sight heads tighten firing solutions but slow movement through cluttered ground.',
    category: 'offense',
    cost: 55,
    requiresResearch: 'optics-i',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { accuracy: 0.04, vision: 1, mobility: -1 }
  },
  {
    id: 'hammerburst-feed',
    name: 'Hammerburst Feed',
    description: 'Aggressive feed timing raises impact energy at the cost of crew confidence under sustained fire.',
    category: 'offense',
    cost: 80,
    requiresResearch: 'sanctified-ammo',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { weaponPower: 4, morale: -6 }
  },
  {
    id: 'vector-range-lattice',
    name: 'Vector Range Lattice',
    description: 'Remote ranging extends every firing envelope while exposed emitters weaken protection.',
    category: 'offense',
    cost: 95,
    requiresResearch: 'optics-ii',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { range: 1, armor: -1 }
  },
  {
    id: 'siege-governor',
    name: 'Siege Governor',
    description: 'A heavy fire-control governor adds force and precision but burdens rapid repositioning.',
    category: 'offense',
    cost: 125,
    requiresResearch: 'siege-ops',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { weaponPower: 3, accuracy: 0.02, mobility: -2 }
  },
  {
    id: 'signal-veil',
    name: 'Signal Veil',
    description: 'Sensor-diffusing screens add a thin defensive layer while narrowing the crew sight picture.',
    category: 'protection',
    cost: 50,
    requiresResearch: 'optics-i',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { armor: 1, vision: -1 }
  },
  {
    id: 'lattice-plate',
    name: 'Lattice Plate',
    description: 'Interlocked composite plates absorb heavy strikes but add weight to every maneuver.',
    category: 'protection',
    cost: 90,
    requiresResearch: 'armor-upfit',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { armor: 3, mobility: -2 }
  },
  {
    id: 'impact-cradle',
    name: 'Impact Cradle',
    description: 'Stabilized crew stations preserve nerve under shock while their heavy mounts slow relocation.',
    category: 'protection',
    cost: 75,
    requiresResearch: 'esprit-de-corps',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { morale: 10, mobility: -1 }
  },
  {
    id: 'aegis-baffles',
    name: 'Aegis Baffles',
    description: 'Layered ward baffles reinforce armor and morale but narrow the sensor field.',
    category: 'protection',
    cost: 135,
    requiresResearch: 'arcane-shielding',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { armor: 2, morale: 6, vision: -2 }
  },
  {
    id: 'trailblazer-drive',
    name: 'Trailblazer Drive',
    description: 'Predictive route control speeds every advance while exposing lighter running protection.',
    category: 'mobility',
    cost: 60,
    requiresResearch: 'optics-i',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { mobility: 2, armor: -1 }
  },
  {
    id: 'survey-mast',
    name: 'Survey Mast',
    description: 'An elevated survey array expands battlefield vision but its constant chatter strains cohesion.',
    category: 'mobility',
    cost: 70,
    requiresResearch: 'optics-ii',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { vision: 2, morale: -6 }
  },
  {
    id: 'relay-harness',
    name: 'Relay Harness',
    description: 'Distributed relays improve route sharing and sighting while their signal load strains cohesion.',
    category: 'mobility',
    cost: 85,
    requiresResearch: 'mobile-supply',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { mobility: 1, vision: 1, morale: -5 }
  },
  {
    id: 'sprint-governor',
    name: 'Sprint Governor',
    description: 'Unlocked drive limits enable rapid redeployment at the cost of vision and firing stability.',
    category: 'mobility',
    cost: 115,
    requiresResearch: 'armor-upfit',
    applyTo: FIELD_UNIT_TYPES,
    modifiers: { mobility: 3, vision: -2, accuracy: -0.02 }
  }
];
