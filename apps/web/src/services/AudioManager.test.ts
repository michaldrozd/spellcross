import { describe, expect, it } from 'vitest';

import { movementSoundDurationSeconds, movementSoundProfileFor } from './AudioManager.js';

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
