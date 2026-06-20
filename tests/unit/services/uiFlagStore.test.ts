import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uiFlagStore } from '../../../services/storage/uiFlagStore';

describe('uiFlagStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // QNBS-v3: clear the module-level session map too, so tests aren't order-dependent.
    uiFlagStore._resetForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('persists and reads a flag via localStorage with the worldscript- prefix', () => {
    expect(uiFlagStore.get('hint-flow')).toBe(false);
    uiFlagStore.set('hint-flow', true);
    expect(uiFlagStore.get('hint-flow')).toBe(true);
    expect(localStorage.getItem('worldscript-hint-flow')).toBe('1');
  });

  it('clears a flag when set to false', () => {
    uiFlagStore.set('hint-focus', true);
    uiFlagStore.set('hint-focus', false);
    expect(localStorage.getItem('worldscript-hint-focus')).toBeNull();
  });

  it('falls back to the session map so a dismissal survives when localStorage write throws', () => {
    // Simulate blocked storage on write (private mode / quota).
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    uiFlagStore.set('hint-proforge', true);
    setSpy.mockRestore();
    // get() consults the in-memory session map first, so the value is still seen.
    expect(uiFlagStore.get('hint-proforge')).toBe(true);
  });

  it('honors a cleared flag even when localStorage removal fails (no stale resurrection)', () => {
    uiFlagStore.set('hint-clearme', true);
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    uiFlagStore.set('hint-clearme', false); // session map = false; localStorage still '1'
    removeSpy.mockRestore();
    // get() trusts the session map (false), not the stale localStorage '1'.
    expect(uiFlagStore.get('hint-clearme')).toBe(false);
  });

  it('returns false (does not throw) when localStorage read throws and no session value exists', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(uiFlagStore.get('hint-never-set')).toBe(false);
  });
});
