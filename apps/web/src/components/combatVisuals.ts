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

export type TargetedCombatEffect = {
  id: string;
  attackerId?: string;
  targetId: string;
  startTime: number;
  type: CombatEffectType;
  arc?: boolean;
  hit?: boolean;
  killed: boolean;
};

export type CombatTimelinePresentationEvent = {
  kind: string;
  attackerId?: string;
  defenderId?: string;
  unitId?: string;
  by?: string;
};

export type FirearmVisualProfile = {
  sheathWidth: number;
  coreWidth: number;
  highlightWidth: number;
  headRadius: number;
  tailFraction: number;
  muzzleFlashMs: number;
};

export function firearmVisualProfile(type: 'gunshot' | 'sniper'): FirearmVisualProfile {
  if (type === 'sniper') {
    return {
      sheathWidth: 2.2,
      coreWidth: 1.1,
      highlightWidth: 0.55,
      headRadius: 1.5,
      tailFraction: 0.22,
      muzzleFlashMs: 90
    };
  }
  return {
    sheathWidth: 1.7,
    coreWidth: 0.82,
    highlightWidth: 0.38,
    headRadius: 1.18,
    tailFraction: 0.1,
    muzzleFlashMs: 72
  };
}

export const CORPSE_TTL_MS = 20_000;
export const CORPSE_FULL_OPACITY_MS = 8_000;
export const WRECK_SMOKE_ANIMATION_MS = 24_000;
export const DEATH_REACTION_HOLD_MS = 360;
export const DEATH_REACTION_FADE_MS = 120;
export const DEATH_REACTION_TOTAL_MS = DEATH_REACTION_HOLD_MS + DEATH_REACTION_FADE_MS;
export const ARTILLERY_TRAIL_FRACTION = 0.28;

export function combatEffectTypeForWeapon(definitionId: string, weaponId: string): CombatEffectType {
  const unitId = definitionId.toLowerCase();
  const weapon = weaponId.toLowerCase();
  const has = (...keywords: string[]) => keywords.some((keyword) => weapon.includes(keyword));
  const caster = unitId.includes('warlock') || unitId.includes('necromancer') || unitId.includes('lich');

  if (has('chain-cannon')) return 'gunshot';
  if (has('fire', 'flame', 'flamer', 'magma', 'breath', 'pyro', 'oil', 'incend')) return 'fire';
  if (has('bow', 'arrow', 'dart', 'crossbow', 'quarrel')) return 'arrow';
  if (has('axe', 'blade', 'sword', 'maul', 'slam', 'fang', 'bite', 'mandible', 'claw', 'cleaver', 'talon',
          'lance', 'spear', 'fist', 'mace', 'hammer', 'gore', 'tusk', 'dive', 'javelin', 'bone', 'razor', 'engulf')) return 'melee';
  if ((caster || has('hex', 'curse', 'doom', 'shadow', 'scream', 'shriek', 'psi', 'spectral', 'bolt',
          'resonance', 'static', 'prism', 'shard', 'void', 'portal', 'silence'))
      && !has('blade', 'cannon', 'shell', 'rocket', 'missile')) return 'magic';
  if (has('shell', 'rocket', 'boulder', 'cannon', 'howitzer', 'mortar', 'siege', 'quake', 'grenade',
          'missile', 'sam', 'flak', 'spit', 'bomb', 'charge') || weapon === 'at' || has('antitank')) return 'explosion';
  if (has('sniper', 'marksman', 'railgun', 'railrifle', 'dmr', 'laser')) return 'sniper';
  return 'gunshot';
}

export function combatEffectForShot(
  definitionId: string,
  weaponId: string,
  attackMode: 'normal' | 'suppressive' = 'normal'
) {
  return {
    type: combatEffectTypeForWeapon(definitionId, weaponId),
    suppressive: attackMode === 'suppressive'
  };
}

const DIRECT_FIRE_TIMING: Record<CombatEffectType, CombatEffectTiming> = {
  gunshot: { projectileMs: 370, impactAtMs: 145, impactMs: 460, totalMs: 2550, burstRounds: 5, burstGapMs: 55, burstFlightMs: 150 },
  sniper: { projectileMs: 180, impactAtMs: 170, impactMs: 500, totalMs: 2600, burstRounds: 1, burstGapMs: 0, burstFlightMs: 180 },
  explosion: { projectileMs: 430, impactAtMs: 430, impactMs: 920, totalMs: 2900, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  magic: { projectileMs: 460, impactAtMs: 460, impactMs: 780, totalMs: 2900, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  melee: { projectileMs: 150, impactAtMs: 150, impactMs: 540, totalMs: 2550, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  arrow: { projectileMs: 520, impactAtMs: 520, impactMs: 520, totalMs: 2950, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 },
  fire: { projectileMs: 390, impactAtMs: 250, impactMs: 900, totalMs: 2700, burstRounds: 0, burstGapMs: 0, burstFlightMs: 0 }
};

const INDIRECT_EXPLOSION_TIMING: CombatEffectTiming = {
  projectileMs: 680,
  impactAtMs: 680,
  impactMs: 1040,
  totalMs: 3250,
  burstRounds: 0,
  burstGapMs: 0,
  burstFlightMs: 0
};

export function combatEffectTiming(type: CombatEffectType, indirect = false): CombatEffectTiming {
  return indirect && type === 'explosion' ? INDIRECT_EXPLOSION_TIMING : DIRECT_FIRE_TIMING[type];
}

export function combatImpactWindowMs(type: CombatEffectType, killed: boolean, baseImpactMs: number) {
  return killed && type === 'explosion' ? Math.max(baseImpactMs, 1200) : baseImpactMs;
}

export function combatTimelineEventVisible(
  event: CombatTimelinePresentationEvent,
  attackEffects: readonly TargetedCombatEffect[],
  now: number
) {
  return !attackEffects.some((effect) => {
    if (!effect.attackerId) return false;
    const impactAt = effect.startTime + combatEffectTiming(effect.type, effect.arc).impactAtMs;
    if (now >= impactAt) return false;
    if (event.kind === 'unit:attacked') {
      return event.attackerId === effect.attackerId && event.defenderId === effect.targetId;
    }
    if (event.kind === 'unit:defeated') {
      return effect.killed && event.unitId === effect.targetId && event.by === effect.attackerId;
    }
    return false;
  });
}

export function activeKillingEffectForTarget<T extends TargetedCombatEffect>(
  attackEffects: readonly T[],
  targetId: string,
  now: number
): T | undefined {
  return attackEffects.find((effect) =>
    effect.targetId === targetId
    && effect.killed
    && now - effect.startTime <= combatEffectTiming(effect.type, effect.arc).totalMs
  );
}

export function deathMarkerVisible(
  effect: TargetedCombatEffect | undefined,
  mechanicalWreck: boolean,
  now: number
) {
  if (!effect) return true;
  const timing = combatEffectTiming(effect.type, effect.arc);
  const elapsedAfterImpact = now - effect.startTime - timing.impactAtMs;
  if (elapsedAfterImpact < 0) return false;
  return mechanicalWreck || elapsedAfterImpact >= DEATH_REACTION_TOTAL_MS;
}

export function deathReactionAlpha(elapsedAfterImpactMs: number) {
  if (elapsedAfterImpactMs <= DEATH_REACTION_HOLD_MS) return 1;
  if (elapsedAfterImpactMs >= DEATH_REACTION_TOTAL_MS) return 0;
  const fade = (elapsedAfterImpactMs - DEATH_REACTION_HOLD_MS) / DEATH_REACTION_FADE_MS;
  const easedFade = fade * fade * (3 - 2 * fade);
  return 1 - easedFade;
}

export function deathMarkerExpired(createdAt: number, now: number, mechanicalWreck: boolean) {
  return !mechanicalWreck && now - createdAt >= CORPSE_TTL_MS;
}

export function deathMarkerFade(elapsedMs: number, mechanicalWreck: boolean) {
  if (mechanicalWreck) return 1;
  const fadeDuration = CORPSE_TTL_MS - CORPSE_FULL_OPACITY_MS;
  return Math.max(0, Math.min(1, (CORPSE_TTL_MS - elapsedMs) / fadeDuration));
}
