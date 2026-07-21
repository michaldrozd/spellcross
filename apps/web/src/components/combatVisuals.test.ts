import { describe, expect, it } from 'vitest';

import { combatEffectTiming } from './combatVisuals.js';

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
