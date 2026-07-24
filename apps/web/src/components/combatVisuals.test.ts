import { describe, expect, it } from 'vitest';

import {
  ARTILLERY_TRAIL_FRACTION,
  DEATH_REACTION_HOLD_MS,
  DEATH_REACTION_TOTAL_MS,
  SMALL_ARMS_DEBRIS_COUNT,
  SMALL_ARMS_DEBRIS_LIFETIME_MS,
  combatEffectForShot,
  combatOutcomePresentationReady,
  combatEffectTiming,
  combatTimelineEventVisible,
  combatEffectTypeForWeapon,
  deathMarkerFade,
  deathMarkerVisible,
  deathReactionAlpha,
  firearmVisualProfile,
  smallArmsDebrisValue
} from './combatVisuals.js';

describe('combatEffectTypeForWeapon', () => {
  it('keeps specific weapon keywords ahead of broad fallback terms for suppressive shots', () => {
    expect(combatEffectTypeForWeapon('silence-stalker', 'silence-claw')).toBe('melee');
    expect(combatEffectTypeForWeapon('siege-engine', 'chain-cannon')).toBe('gunshot');
    expect(combatEffectTypeForWeapon('skeleton-archer', 'bone-quarrel')).toBe('arrow');
    expect(combatEffectForShot('skeleton-archer', 'bone-quarrel', 'suppressive')).toEqual({
      type: 'arrow',
      suppressive: true
    });
  });
});

describe('combatEffectTiming', () => {
  it('starts direct impacts when their projectiles arrive', () => {
    for (const type of ['explosion', 'magic', 'arrow'] as const) {
      const timing = combatEffectTiming(type);
      expect(timing.impactAtMs).toBe(timing.projectileMs);
      expect(timing.impactAtMs + timing.impactMs).toBeLessThanOrEqual(timing.totalMs);
    }
  });

  it('keeps every burst round inside the projectile window', () => {
    const timing = combatEffectTiming('gunshot');
    const lastRoundArrival = (timing.burstRounds - 1) * timing.burstGapMs + timing.burstFlightMs;

    expect(timing.impactAtMs).toBeGreaterThanOrEqual(timing.burstFlightMs - 10);
    expect(lastRoundArrival).toBeLessThanOrEqual(timing.projectileMs);
  });

  it('aligns firearm and flame impacts with their first visible arrival', () => {
    const gunshot = combatEffectTiming('gunshot');
    const sniper = combatEffectTiming('sniper');
    const fire = combatEffectTiming('fire');

    expect(gunshot.impactAtMs).toBe(gunshot.burstFlightMs - 5);
    expect(sniper.impactAtMs).toBe(sniper.projectileMs - 10);
    expect(fire.impactAtMs).toBeLessThan(fire.projectileMs);
    expect(fire.impactAtMs).toBeGreaterThan(fire.projectileMs / 2);
  });

  it('gives indirect shells a longer readable arc', () => {
    const direct = combatEffectTiming('explosion');
    const indirect = combatEffectTiming('explosion', true);
    const visibleTrailFramesAt60Fps = indirect.projectileMs * ARTILLERY_TRAIL_FRACTION / (1000 / 60);

    expect(indirect.projectileMs).toBeGreaterThan(direct.projectileMs);
    expect(indirect.impactAtMs).toBe(indirect.projectileMs);
    expect(indirect.totalMs).toBeGreaterThan(direct.totalMs);
    expect(visibleTrailFramesAt60Fps).toBeGreaterThanOrEqual(8);
  });

  it('keeps a destroyed unit visible through a readable death reaction', () => {
    for (const type of ['gunshot', 'sniper', 'explosion', 'magic', 'melee', 'arrow', 'fire'] as const) {
      const timing = combatEffectTiming(type);
      expect(timing.totalMs - timing.impactAtMs).toBeGreaterThanOrEqual(2200);
    }
  });
});

describe('firearmVisualProfile', () => {
  it('keeps rifle tracers fine while preserving the single-shot sniper language', () => {
    const rifle = firearmVisualProfile('gunshot');
    const sniper = firearmVisualProfile('sniper');

    expect(rifle.sheathWidth).toBeLessThanOrEqual(1.8);
    expect(rifle.coreWidth).toBeLessThanOrEqual(0.9);
    expect(rifle.headRadius).toBeLessThanOrEqual(1.4);
    expect(rifle.muzzleFlashMs / (1000 / 60)).toBeGreaterThanOrEqual(4);
    expect(sniper.sheathWidth).toBeGreaterThan(rifle.sheathWidth);
    expect(sniper.coreWidth).toBeGreaterThan(rifle.coreWidth);
    expect(sniper.tailFraction).toBeGreaterThan(rifle.tailFraction);
    expect(sniper.muzzleFlashMs).toBeGreaterThan(rifle.muzzleFlashMs);
  });
});

describe('death reaction transition', () => {
  const killingShot = {
    id: 'shot-1',
    targetId: 'squad-1',
    startTime: 1000,
    type: 'gunshot' as const,
    killed: true
  };

  it('holds a readable hit reaction, then cuts cleanly to an organic corpse', () => {
    const impactAt = 1000 + combatEffectTiming('gunshot').impactAtMs;

    expect(deathReactionAlpha(0)).toBe(1);
    expect(deathReactionAlpha(DEATH_REACTION_HOLD_MS)).toBe(1);
    expect(deathReactionAlpha(DEATH_REACTION_TOTAL_MS - 1)).toBeGreaterThan(0);
    expect(deathReactionAlpha(DEATH_REACTION_TOTAL_MS)).toBe(0);
    expect(deathMarkerVisible(killingShot, false, impactAt + DEATH_REACTION_TOTAL_MS - 1)).toBe(false);
    expect(deathMarkerVisible(killingShot, false, impactAt + DEATH_REACTION_TOTAL_MS)).toBe(true);
  });

  it('still reveals a mechanical wreck at impact', () => {
    const impactAt = 1000 + combatEffectTiming('gunshot').impactAtMs;

    expect(deathMarkerVisible(killingShot, true, impactAt - 1)).toBe(false);
    expect(deathMarkerVisible(killingShot, true, impactAt)).toBe(true);
  });
});

describe('combat timeline presentation', () => {
  const directEffect = {
    id: 'rifle-shot',
    attackerId: 'squad-1',
    targetId: 'enemy-1',
    timelineStartIndex: 20,
    timelineEndIndex: 25,
    startTime: 1000,
    type: 'gunshot' as const,
    killed: true
  };
  const indirectEffect = {
    ...directEffect,
    id: 'howitzer-shot',
    type: 'explosion' as const,
    arc: true
  };
  const hitEvent = {
    kind: 'unit:attacked',
    attackerId: 'squad-1',
    defenderId: 'enemy-1'
  };
  const defeatEvent = {
    kind: 'unit:defeated',
    unitId: 'enemy-1',
    by: 'squad-1'
  };

  it('reveals direct-fire results exactly when the visible shot arrives', () => {
    const impactAt = 1000 + combatEffectTiming('gunshot').impactAtMs;

    expect(combatTimelineEventVisible(hitEvent, [directEffect], impactAt - 1, 20)).toBe(false);
    expect(combatTimelineEventVisible(defeatEvent, [directEffect], impactAt - 1, 21)).toBe(false);
    expect(combatTimelineEventVisible(hitEvent, [directEffect], impactAt, 20)).toBe(true);
    expect(combatTimelineEventVisible(defeatEvent, [directEffect], impactAt, 21)).toBe(true);
  });

  it('keeps indirect-fire results hidden for the full shell flight', () => {
    const impactAt = 1000 + combatEffectTiming('explosion', true).impactAtMs;

    expect(combatTimelineEventVisible(hitEvent, [indirectEffect], impactAt - 1, 20)).toBe(false);
    expect(combatTimelineEventVisible(defeatEvent, [indirectEffect], impactAt - 1, 21)).toBe(false);
    expect(combatTimelineEventVisible(hitEvent, [indirectEffect], impactAt, 20)).toBe(true);
  });

  it('holds correlated passenger defeats and attacker promotions until impact', () => {
    const beforeImpact = 1000 + combatEffectTiming('explosion', true).impactAtMs - 1;

    expect(combatTimelineEventVisible(
      { kind: 'unit:defeated', unitId: 'passenger-1', by: 'squad-1' },
      [indirectEffect],
      beforeImpact,
      23
    )).toBe(false);
    expect(combatTimelineEventVisible(
      { kind: 'unit:level', unitId: 'squad-1' },
      [indirectEffect],
      beforeImpact,
      24
    )).toBe(false);
  });

  it('does not re-hide an older result when the same pair fires again', () => {
    const secondShot = {
      ...indirectEffect,
      id: 'second-howitzer-shot',
      timelineStartIndex: 30,
      timelineEndIndex: 35,
      startTime: 2000
    };
    const firstImpact = 1000 + combatEffectTiming('explosion', true).impactAtMs;

    expect(combatTimelineEventVisible(hitEvent, [indirectEffect, secondShot], firstImpact, 20)).toBe(true);
    expect(combatTimelineEventVisible(hitEvent, [indirectEffect, secondShot], 2001, 30)).toBe(false);
  });

  it('does not delay unrelated timeline entries', () => {
    expect(combatTimelineEventVisible(
      { ...hitEvent, defenderId: 'enemy-2' },
      [indirectEffect],
      1001,
      20
    )).toBe(true);
    expect(combatTimelineEventVisible({ kind: 'round:started' }, [indirectEffect], 1001, 19)).toBe(true);
  });

  it('reveals the outcome with its killing impact and fails open when no shot is presentable', () => {
    const impactAt = directEffect.startTime + combatEffectTiming(directEffect.type).impactAtMs;
    const visibleKillingEffect = {
      ...directEffect,
      sourceVisible: true,
      targetVisible: true
    };

    expect(combatOutcomePresentationReady([visibleKillingEffect], 25, impactAt - 1)).toBe(false);
    expect(combatOutcomePresentationReady([visibleKillingEffect], 25, impactAt)).toBe(true);
    expect(combatOutcomePresentationReady([visibleKillingEffect], 25, impactAt - 1, false)).toBe(true);
    expect(combatOutcomePresentationReady([
      { ...visibleKillingEffect, sourceVisible: false, targetVisible: false }
    ], 25, impactAt - 1)).toBe(true);
    expect(combatOutcomePresentationReady([
      { ...visibleKillingEffect, timelineEndIndex: 24 }
    ], 25, impactAt - 1)).toBe(true);
  });
});

describe('small-arms debris', () => {
  it('is deterministic, bounded and short-lived', () => {
    const firstPass = Array.from({ length: SMALL_ARMS_DEBRIS_COUNT }, (_, particleIndex) =>
      smallArmsDebrisValue(42, particleIndex, 3)
    );
    const secondPass = Array.from({ length: SMALL_ARMS_DEBRIS_COUNT }, (_, particleIndex) =>
      smallArmsDebrisValue(42, particleIndex, 3)
    );

    expect(firstPass).toEqual(secondPass);
    expect(new Set(firstPass).size).toBe(SMALL_ARMS_DEBRIS_COUNT);
    expect(firstPass.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(SMALL_ARMS_DEBRIS_LIFETIME_MS).toBeLessThanOrEqual(400);
  });
});

describe('deathMarkerFade', () => {
  it('holds organic silhouettes at full opacity before a smooth fade and keeps wrecks persistent', () => {
    expect(deathMarkerFade(0, false)).toBe(1);
    expect(deathMarkerFade(8_000, false)).toBe(1);
    expect(deathMarkerFade(14_000, false)).toBe(0.5);
    expect(deathMarkerFade(20_000, false)).toBe(0);
    expect(deathMarkerFade(40_000, true)).toBe(1);
  });
});
