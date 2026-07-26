import type { OfficerProfile, OfficerRankSpec } from './index.js';

export const starterOfficerProfiles: OfficerProfile[] = [
  {
    id: 'arden-kade',
    name: 'Arden Kade',
    callsign: 'Breaker',
    description: 'A breach planner who turns concentrated fire into decisive local superiority.',
    recruitCost: 135,
    bonus: { attack: 2, defense: 0, morale: 0 }
  },
  {
    id: 'mirela-sorn',
    name: 'Mirela Sorn',
    callsign: 'Rampart',
    description: 'A defensive tactician known for layered positions and disciplined fallback lines.',
    recruitCost: 135,
    bonus: { attack: 0, defense: 2, morale: 0 }
  },
  {
    id: 'tomas-vey',
    name: 'Tomas Vey',
    callsign: 'Steadfast',
    description: 'A calm field leader whose formations keep cohesion under supernatural pressure.',
    recruitCost: 120,
    bonus: { attack: 0, defense: 0, morale: 6 }
  },
  {
    id: 'anika-rell',
    name: 'Anika Rell',
    callsign: 'Tempo',
    description: 'An aggressive coordinator who keeps fire teams moving without breaking their nerve.',
    recruitCost: 125,
    bonus: { attack: 1, defense: 0, morale: 3 }
  },
  {
    id: 'elias-dorn',
    name: 'Elias Dorn',
    callsign: 'Warden',
    description: 'A measured protector who binds prepared defenses to steady battlefield control.',
    recruitCost: 125,
    bonus: { attack: 0, defense: 1, morale: 3 }
  },
  {
    id: 'samira-kest',
    name: 'Samira Kest',
    callsign: 'Concord',
    description: 'A combined-arms specialist who trades extremes for reliable strength across the line.',
    recruitCost: 130,
    bonus: { attack: 1, defense: 1, morale: 1 }
  }
];

export const starterOfficerRanks: OfficerRankSpec[] = [
  {
    id: 'field-adjutant',
    name: 'Field Adjutant',
    requiredService: 0,
    promotionCost: 0,
    capacity: 6,
    bonus: { attack: 0, defense: 0, morale: 0 }
  },
  {
    id: 'line-lieutenant',
    name: 'Line Lieutenant',
    requiredService: 1,
    promotionCost: 90,
    capacity: 7,
    bonus: { attack: 0, defense: 0, morale: 1 }
  },
  {
    id: 'battle-captain',
    name: 'Battle Captain',
    requiredService: 3,
    promotionCost: 160,
    capacity: 8,
    bonus: { attack: 1, defense: 1, morale: 2 }
  },
  {
    id: 'sector-commandant',
    name: 'Sector Commandant',
    requiredService: 6,
    promotionCost: 260,
    capacity: 10,
    bonus: { attack: 2, defense: 2, morale: 4 }
  }
];
