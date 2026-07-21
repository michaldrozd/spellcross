export type CombatEffectType = 'gunshot' | 'explosion' | 'magic' | 'melee' | 'arrow' | 'fire' | 'sniper';

export type CombatEffectTiming = {
  projectileMs: number;
  impactAtMs: number;
  impactMs: number;
  totalMs: number;
  burstRounds: number;
  burstGapMs: number;
  burstFlightMs: number;
};

const DIRECT_FIRE_TIMING: Record<CombatEffectType, CombatEffectTiming> = {
  gunshot: { projectileMs: 370, impactAtMs: 145, impactMs: 460, totalMs: 1750, burstRounds: 5, burstGapMs: 55, burstFlightMs: 150 },
  sniper: { projectileMs: 180, impactAtMs: 170, impactMs: 500, totalMs: 1800, burstRounds: 1, burstGapMs: 0, burstFlightMs: 180 },
  explosion: { projectileMs: 430, impactAtMs: 430, impactMs: 780, totalMs: 2050, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  magic: { projectileMs: 460, impactAtMs: 460, impactMs: 720, totalMs: 2000, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  melee: { projectileMs: 150, impactAtMs: 150, impactMs: 480, totalMs: 1550, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  arrow: { projectileMs: 520, impactAtMs: 520, impactMs: 480, totalMs: 1850, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  fire: { projectileMs: 390, impactAtMs: 250, impactMs: 780, totalMs: 1900, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 }
};

const INDIRECT_EXPLOSION_TIMING: CombatEffectTiming = {
  projectileMs: 680,
  impactAtMs: 680,
  impactMs: 900,
  totalMs: 2250,
  burstRounds: 0,
  burstGapMs: 0,
  burstFlightMs: 0
};

export function combatEffectTiming(type: CombatEffectType, indirect = false): CombatEffectTiming {
  return indirect && type === 'explosion' ? INDIRECT_EXPLOSION_TIMING : DIRECT_FIRE_TIMING[type];
}
