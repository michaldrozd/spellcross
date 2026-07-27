import type { ResearchTopic, UnitData } from './index.js';

export const rosterExpansionUnits: UnitData[] = [
  {
    id: 'firefly-105', name: 'Firefly 105 Battery', faction: 'alliance', type: 'artillery', role: 'support', cost: 145,
    stats: {
      maxHealth: 85, mobility: 8, vision: 5, armor: 3, morale: 68, ammoCapacity: 8,
      weaponRanges: { 'fragment-shell': 8 }, weaponPower: { 'fragment-shell': 19 }, weaponAccuracy: { 'fragment-shell': 0.66 },
      weaponFireModes: { 'fragment-shell': 'indirect' },
      weaponTargets: { 'fragment-shell': ['infantry', 'support', 'hero'] }
    }
  },
  {
    id: 'badger-mortar-carrier', name: 'Badger Mortar Carrier', faction: 'alliance', type: 'artillery', role: 'support', cost: 175,
    stats: {
      maxHealth: 75, mobility: 9, vision: 5, armor: 3, morale: 65, ammoCapacity: 8,
      weaponRanges: { mortar: 9 }, weaponPower: { mortar: 22 }, weaponAccuracy: { mortar: 0.6 },
      weaponFireModes: { mortar: 'indirect' },
      weaponTargets: { mortar: ['infantry', 'vehicle', 'artillery', 'support', 'hero'] }
    }
  },
  {
    id: 'thunderhead-155', name: 'Thunderhead 155 SPG', faction: 'alliance', type: 'artillery', role: 'support', cost: 275,
    stats: {
      maxHealth: 95, mobility: 5, vision: 5, armor: 5, morale: 72, ammoCapacity: 5,
      weaponRanges: { howitzer: 12 }, weaponPower: { howitzer: 36 }, weaponAccuracy: { howitzer: 0.55 },
      weaponFireModes: { howitzer: 'indirect' },
      weaponTargets: { howitzer: ['infantry', 'vehicle', 'artillery', 'support', 'hero'] }
    }
  },
  {
    id: 'tempest-counterbattery', name: 'Tempest Counterbattery Gun', faction: 'alliance', type: 'artillery', role: 'support', cost: 260,
    stats: {
      maxHealth: 80, mobility: 6, vision: 8, armor: 3, morale: 74, ammoCapacity: 6,
      weaponRanges: { 'counterbattery-shell': 15 }, weaponPower: { 'counterbattery-shell': 31 }, weaponAccuracy: { 'counterbattery-shell': 0.64 },
      weaponFireModes: { 'counterbattery-shell': 'indirect' },
      weaponTargets: { 'counterbattery-shell': ['vehicle', 'artillery', 'support'] }
    }
  },
  {
    id: 'horizon-radar', name: 'Horizon Counterbattery Radar', faction: 'alliance', type: 'support', role: 'recon', cost: 125,
    stats: {
      maxHealth: 60, mobility: 8, vision: 12, armor: 2, morale: 75,
      weaponRanges: {}, weaponPower: {}, weaponAccuracy: {}
    }
  },
  {
    id: 'tidewalker-apc', name: 'Tidewalker APC', faction: 'alliance', type: 'vehicle', role: 'support', cost: 155,
    stats: {
      maxHealth: 90, mobility: 11, vision: 5, armor: 5, morale: 67, ammoCapacity: 8, transportCapacity: 3,
      weaponRanges: { autocannon: 4 }, weaponPower: { autocannon: 13 }, weaponAccuracy: { autocannon: 0.64 }
    }
  },
  {
    id: 'aegis-assault-tank', name: 'Aegis Assault Tank', faction: 'alliance', type: 'vehicle', role: 'line', cost: 310,
    stats: {
      maxHealth: 145, mobility: 6, vision: 6, armor: 11, morale: 80, ammoCapacity: 8,
      weaponRanges: { 'breach-cannon': 7, coax: 3 }, weaponPower: { 'breach-cannon': 34, coax: 9 }, weaponAccuracy: { 'breach-cannon': 0.67, coax: 0.56 }
    }
  },
  {
    id: 'valkyrie-mobile-infantry', name: 'Valkyrie Mobile Infantry', faction: 'alliance', type: 'infantry', role: 'line', cost: 190,
    stats: {
      maxHealth: 95, mobility: 10, vision: 6, armor: 4, morale: 80, ammoCapacity: 10,
      weaponRanges: { carbine: 5, 'smart-rocket': 5 }, weaponPower: { carbine: 15, 'smart-rocket': 21 }, weaponAccuracy: { carbine: 0.72, 'smart-rocket': 0.67 },
      weaponTargets: { 'smart-rocket': ['vehicle', 'air', 'artillery'] }
    }
  },
  {
    id: 'breach-engineers', name: 'Breach Engineers', faction: 'alliance', type: 'infantry', role: 'support', cost: 135,
    stats: {
      maxHealth: 90, mobility: 7, vision: 5, armor: 3, morale: 76, ammoCapacity: 6,
      weaponRanges: { shotgun: 3, 'demolition-charge': 1 }, weaponPower: { shotgun: 17, 'demolition-charge': 38 }, weaponAccuracy: { shotgun: 0.75, 'demolition-charge': 0.9 },
      weaponTargets: { 'demolition-charge': ['vehicle', 'artillery', 'support'] }
    }
  },
  {
    id: 'cerberus-gunship', name: 'Cerberus Gunship', faction: 'alliance', type: 'air', role: 'support', cost: 285,
    stats: {
      maxHealth: 105, mobility: 13, vision: 7, armor: 5, morale: 78, ammoCapacity: 10,
      weaponRanges: { 'chain-cannon': 5, 'hunter-missile': 6 }, weaponPower: { 'chain-cannon': 18, 'hunter-missile': 28 }, weaponAccuracy: { 'chain-cannon': 0.68, 'hunter-missile': 0.64 },
      weaponTargets: { 'hunter-missile': ['vehicle', 'air', 'artillery', 'support'] }
    }
  },
  {
    id: 'kestrel-recon-drone', name: 'Kestrel Recon Drone', faction: 'alliance', type: 'air', role: 'recon', cost: 130,
    stats: {
      maxHealth: 55, mobility: 15, vision: 11, armor: 1, morale: 100, ammoCapacity: 8,
      weaponRanges: { 'laser-designator': 6 }, weaponPower: { 'laser-designator': 7 }, weaponAccuracy: { 'laser-designator': 0.82 }
    }
  },
  {
    id: 'wardog-fire-support', name: 'Wardog Fire Support Vehicle', faction: 'alliance', type: 'vehicle', role: 'support', cost: 205,
    stats: {
      maxHealth: 105, mobility: 9, vision: 6, armor: 6, morale: 72, ammoCapacity: 10,
      weaponRanges: { autocannon: 6, 'hunter-missile': 5 }, weaponPower: { autocannon: 17, 'hunter-missile': 25 }, weaponAccuracy: { autocannon: 0.68, 'hunter-missile': 0.62 },
      weaponTargets: { 'hunter-missile': ['vehicle', 'air', 'artillery', 'support'] }
    }
  },
  {
    id: 'razorwing-flock', name: 'Razorwing Flock', faction: 'otherSide', type: 'air', role: 'recon', cost: 0,
    stats: {
      maxHealth: 50, mobility: 15, vision: 7, armor: 1, morale: 75, fear: 1,
      weaponRanges: { razors: 1, shriek: 3 }, weaponPower: { razors: 16, shriek: 8 }, weaponAccuracy: { razors: 0.86, shriek: 0.75 }
    }
  },
  {
    id: 'gloom-balloon', name: 'Gloom Balloon', faction: 'otherSide', type: 'air', role: 'recon', cost: 0,
    stats: {
      maxHealth: 80, mobility: 7, vision: 11, armor: 2, morale: 90, fear: 1,
      weaponRanges: { 'ember-bomb': 3 }, weaponPower: { 'ember-bomb': 16 }, weaponAccuracy: { 'ember-bomb': 0.62 },
      weaponTargets: { 'ember-bomb': ['infantry', 'vehicle', 'artillery', 'support', 'hero'] }
    }
  },
  {
    id: 'ironroot-colossus', name: 'Ironroot Colossus', faction: 'otherSide', type: 'vehicle', role: 'line', cost: 0,
    stats: {
      maxHealth: 180, mobility: 4, vision: 5, armor: 12, morale: 95, fear: 2,
      weaponRanges: { tusks: 1, 'spore-mortar': 5 }, weaponPower: { tusks: 38, 'spore-mortar': 22 }, weaponAccuracy: { tusks: 0.82, 'spore-mortar': 0.56 },
      weaponFireModes: { 'spore-mortar': 'indirect' },
      weaponTargets: { 'spore-mortar': ['infantry', 'vehicle', 'artillery', 'support', 'hero'] }
    }
  },
  {
    id: 'bone-ballista', name: 'Bone Ballista', faction: 'otherSide', type: 'artillery', role: 'support', cost: 0,
    stats: {
      maxHealth: 70, mobility: 4, vision: 6, armor: 3, morale: 80, fear: 1,
      weaponRanges: { 'bone-quarrel': 9 }, weaponPower: { 'bone-quarrel': 28 }, weaponAccuracy: { 'bone-quarrel': 0.68 },
      weaponTargets: { 'bone-quarrel': ['vehicle', 'air', 'artillery', 'support'] }
    }
  },
  {
    id: 'resonance-cannon', name: 'Resonance Cannon', faction: 'otherSide', type: 'artillery', role: 'support', cost: 0,
    stats: {
      maxHealth: 90, mobility: 3, vision: 7, armor: 7, morale: 90, fear: 2,
      weaponRanges: { 'resonance-wave': 10 }, weaponPower: { 'resonance-wave': 25 }, weaponAccuracy: { 'resonance-wave': 0.7 },
      weaponTargets: { 'resonance-wave': ['infantry', 'support', 'hero'] }
    }
  },
  {
    id: 'slime-harvester', name: 'Slime Harvester', faction: 'otherSide', type: 'vehicle', role: 'line', cost: 0,
    stats: {
      maxHealth: 130, mobility: 6, vision: 5, armor: 6, morale: 75, fear: 1,
      weaponRanges: { 'acid-spit': 5, engulf: 1 }, weaponPower: { 'acid-spit': 20, engulf: 24 }, weaponAccuracy: { 'acid-spit': 0.66, engulf: 0.82 },
      weaponTargets: { 'acid-spit': ['vehicle', 'artillery', 'support'] }
    }
  },
  {
    id: 'rift-predator', name: 'Rift Predator', faction: 'otherSide', type: 'infantry', role: 'recon', cost: 0,
    stats: {
      maxHealth: 75, mobility: 11, vision: 8, armor: 2, morale: 85, stealth: 3, fear: 1,
      weaponRanges: { 'phase-claw': 1, 'void-dart': 4 }, weaponPower: { 'phase-claw': 28, 'void-dart': 13 }, weaponAccuracy: { 'phase-claw': 0.88, 'void-dart': 0.68 }
    }
  },
  {
    id: 'veil-magus', name: 'Veil Magus', faction: 'otherSide', type: 'support', role: 'commander', cost: 0,
    stats: {
      maxHealth: 70, mobility: 7, vision: 8, armor: 2, morale: 88, stealth: 1, fear: 2,
      weaponRanges: { 'silence-hex': 7 }, weaponPower: { 'silence-hex': 18 }, weaponAccuracy: { 'silence-hex': 0.76 },
      weaponTargets: { 'silence-hex': ['infantry', 'support', 'hero'] }
    }
  },
  {
    id: 'gate-conjurer', name: 'Gate Conjurer', faction: 'otherSide', type: 'support', role: 'commander', cost: 0,
    stats: {
      maxHealth: 85, mobility: 5, vision: 7, armor: 3, morale: 90, fear: 2,
      weaponRanges: { 'portal-bolt': 6 }, weaponPower: { 'portal-bolt': 23 }, weaponAccuracy: { 'portal-bolt': 0.68 }
    }
  },
  {
    id: 'thorn-elf-master', name: 'Thorn Elf Master', faction: 'otherSide', type: 'infantry', role: 'recon', cost: 0,
    stats: {
      maxHealth: 85, mobility: 8, vision: 7, armor: 3, morale: 82, stealth: 1,
      weaponRanges: { 'thorn-bow': 8 }, weaponPower: { 'thorn-bow': 20 }, weaponAccuracy: { 'thorn-bow': 0.78 }
    }
  },
  {
    id: 'ash-mammoth', name: 'Ash Mammoth', faction: 'otherSide', type: 'vehicle', role: 'line', cost: 0,
    stats: {
      maxHealth: 210, mobility: 3, vision: 6, armor: 14, morale: 100, fear: 3,
      weaponRanges: { 'siege-tusk': 1, 'furnace-shell': 8 }, weaponPower: { 'siege-tusk': 42, 'furnace-shell': 32 }, weaponAccuracy: { 'siege-tusk': 0.82, 'furnace-shell': 0.58 }
    }
  },
  {
    id: 'dread-fortress', name: 'Walking Dread Fortress', faction: 'otherSide', type: 'vehicle', role: 'line', cost: 0,
    stats: {
      maxHealth: 280, mobility: 2, vision: 9, armor: 16, morale: 100, fear: 3,
      weaponRanges: { 'doom-cannon': 11, 'hell-bolts': 6 }, weaponPower: { 'doom-cannon': 40, 'hell-bolts': 22 }, weaponAccuracy: { 'doom-cannon': 0.62, 'hell-bolts': 0.68 }
    }
  },
  {
    id: 'signal-eater', name: 'The Signal-Eater', faction: 'otherSide', type: 'support', role: 'commander', cost: 0,
    stats: {
      maxHealth: 160, mobility: 8, vision: 10, armor: 6, morale: 100, stealth: 2, fear: 3,
      weaponRanges: { 'static-burst': 8, 'silence-claw': 1 }, weaponPower: { 'static-burst': 28, 'silence-claw': 35 }, weaponAccuracy: { 'static-burst': 0.76, 'silence-claw': 0.86 }
    }
  },
  {
    id: 'glass-regent', name: 'The Glass Regent', faction: 'otherSide', type: 'vehicle', role: 'commander', cost: 0,
    stats: {
      maxHealth: 240, mobility: 5, vision: 8, armor: 13, morale: 100, fear: 3,
      weaponRanges: { 'prism-beam': 9, 'shard-storm': 4 }, weaponPower: { 'prism-beam': 36, 'shard-storm': 24 }, weaponAccuracy: { 'prism-beam': 0.72, 'shard-storm': 0.74 }
    }
  },
  {
    id: 'ash-crown-sovereign', name: 'Ash Crown Sovereign', faction: 'otherSide', type: 'air', role: 'commander', cost: 0,
    stats: {
      maxHealth: 220, mobility: 12, vision: 10, armor: 10, morale: 100, fear: 3,
      weaponRanges: { 'crown-fire': 7, 'eclipse-dive': 1 }, weaponPower: { 'crown-fire': 34, 'eclipse-dive': 45 }, weaponAccuracy: { 'crown-fire': 0.72, 'eclipse-dive': 0.84 }
    }
  },
  {
    id: 'renegade-cell', name: 'Renegade Fireteam', faction: 'otherSide', type: 'infantry', role: 'recon', cost: 0,
    stats: {
      maxHealth: 95, mobility: 8, vision: 7, armor: 3, morale: 75, stealth: 1,
      weaponRanges: { 'battle-rifle': 6, 'antitank-charge': 2 }, weaponPower: { 'battle-rifle': 16, 'antitank-charge': 28 }, weaponAccuracy: { 'battle-rifle': 0.7, 'antitank-charge': 0.72 },
      weaponTargets: { 'antitank-charge': ['vehicle', 'artillery', 'support'] }
    }
  }
];

export const rosterExpansionResearch: ResearchTopic[] = [
  {
    id: 'mobile-fire-support',
    name: 'Mobile Fire Support',
    description: 'Light batteries and mortar carriers keep pace with the maneuver force.',
    cost: 110,
    unlocks: [],
    requires: ['esprit-de-corps']
  },
  {
    id: 'deep-fires-network',
    name: 'Deep Fires Network',
    description: 'Counterbattery radar links long-range guns into a coordinated strike grid.',
    cost: 220,
    unlocks: [],
    requires: ['siege-ops']
  },
  {
    id: 'expeditionary-mobility',
    name: 'Expeditionary Mobility',
    description: 'Fast transports and mobile assault teams exploit gaps before the enemy can reform.',
    cost: 160,
    unlocks: [],
    requires: ['armor-upfit', 'esprit-de-corps']
  },
  {
    id: 'autonomous-recon',
    name: 'Autonomous Recon Wing',
    description: 'Recon drones and hunter gunships extend the Alliance sensor and strike envelope.',
    cost: 180,
    unlocks: [],
    requires: ['optics-ii']
  },
  {
    id: 'aegis-project',
    name: 'Aegis Project',
    description: 'A protected breakthrough chassis carries the war into fortified rift zones.',
    cost: 260,
    unlocks: [],
    requires: ['arcane-shielding']
  }
];
