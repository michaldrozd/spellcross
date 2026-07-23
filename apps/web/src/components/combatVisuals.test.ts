import { describe, expect, it } from 'vitest';

import {
  combatEffectForShot,
  combatEffectTiming,
  combatEffectTypeForWeapon,
  deathMarkerFade,
  firearmVisualProfile
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

    expect(indirect.projectileMs).toBeGreaterThan(direct.projectileMs);
    expect(indirect.impactAtMs).toBe(indirect.projectileMs);
    expect(indirect.totalMs).toBeGreaterThan(direct.totalMs);
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
    expect(sniper.sheathWidth).toBeGreaterThan(rifle.sheathWidth);
    expect(sniper.coreWidth).toBeGreaterThan(rifle.coreWidth);
    expect(sniper.tailFraction).toBeGreaterThan(rifle.tailFraction);
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
