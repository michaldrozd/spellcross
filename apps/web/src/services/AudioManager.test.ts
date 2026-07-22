import { describe, expect, it } from 'vitest';

import {
  ambienceProfileFor,
  movementSoundDurationSeconds,
  movementSoundProfileFor,
  narrativeSoundTypeForOutcome
} from './AudioManager.js';

describe('movement sound profiles', () => {
  it('uses wheeled diesel movement for battlefield support vehicles', () => {
    expect(movementSoundProfileFor('support', 'supply-truck')).toBe('wheel');
    expect(movementSoundProfileFor('support', 'horizon-radar')).toBe('wheel');
  });

  it('keeps tracks, rotors and foot crews distinct', () => {
    expect(movementSoundProfileFor('vehicle', 'm113')).toBe('track');
    expect(movementSoundProfileFor('artillery', 'thunderhead-155')).toBe('track');
    expect(movementSoundProfileFor('air', 'cerberus-gunship')).toBe('rotor');
    expect(movementSoundProfileFor('artillery', 'mortar-team')).toBe('foot');
  });

  it('covers a full eight-step supply run instead of cutting off after 2.6 seconds', () => {
    expect(movementSoundDurationSeconds(8 * 420)).toBe(3.36);
    expect(movementSoundDurationSeconds(20_000)).toBe(8);
  });
});

describe('operation audio dramaturgy', () => {
  it('keeps all four campaign moods sonically distinct', () => {
    const frontline = ambienceProfileFor('frontline');
    const siege = ambienceProfileFor('siege');
    const night = ambienceProfileFor('night');
    const rift = ambienceProfileFor('rift');

    expect(new Set([frontline.root, siege.root, night.root, rift.root])).toHaveLength(4);
    expect(siege.pulse).toBeGreaterThan(frontline.pulse);
    expect(night.cutoff).toBeLessThan(frontline.cutoff);
    expect(rift.harmony).not.toEqual(frontline.harmony);
  });

  it('uses dedicated debrief cues instead of the generic result fanfares', () => {
    expect(narrativeSoundTypeForOutcome('victory')).toBe('debriefVictory');
    expect(narrativeSoundTypeForOutcome('defeat')).toBe('debriefDefeat');
  });
});
