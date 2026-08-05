import { afterEach, describe, expect, it, vi } from 'vitest';

import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from './browserStorage.js';

describe('browser storage boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('distinguishes an absent key from an unavailable read', () => {
    expect(readBrowserStorage('spellcross:missing')).toEqual({ storedText: null, available: true });

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(readBrowserStorage('spellcross:blocked')).toEqual({ storedText: null, available: false });
  });

  it('reports failed writes without throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(writeBrowserStorage('spellcross:campaign-state:1', '{}')).toBe(false);
  });

  it('reports failed removals without throwing', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(removeBrowserStorage('spellcross:campaign-state:1')).toBe(false);
  });
});
