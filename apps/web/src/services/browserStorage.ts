export interface BrowserStorageRead {
  storedText: string | null;
  available: boolean;
}

function warnStorageFailure(operation: 'read' | 'write' | 'remove' | 'list', storageKey: string, error: unknown) {
  console.warn(`Browser storage ${operation} failed for ${storageKey}`, error);
}

export function readBrowserStorage(storageKey: string): BrowserStorageRead {
  if (typeof window === 'undefined') return { storedText: null, available: true };
  try {
    return { storedText: window.localStorage.getItem(storageKey), available: true };
  } catch (error) {
    warnStorageFailure('read', storageKey, error);
    return { storedText: null, available: false };
  }
}

export function writeBrowserStorage(storageKey: string, storedText: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    window.localStorage.setItem(storageKey, storedText);
    return true;
  } catch (error) {
    warnStorageFailure('write', storageKey, error);
    return false;
  }
}

export function removeBrowserStorage(storageKey: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    window.localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    warnStorageFailure('remove', storageKey, error);
    return false;
  }
}

export function removeBrowserStorageByPrefix(storageKeyPrefix: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    let removed = true;
    for (const storageKey of Object.keys(window.localStorage)) {
      if (storageKey.startsWith(storageKeyPrefix) && !removeBrowserStorage(storageKey)) removed = false;
    }
    return removed;
  } catch (error) {
    warnStorageFailure('list', storageKeyPrefix, error);
    return false;
  }
}
