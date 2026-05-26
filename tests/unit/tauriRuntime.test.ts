/**
 * Tests for services/tauriRuntime.ts
 * QNBS-v3: Covers isTauriRuntime detection and non-Tauri fallback paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('isTauriRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when window is undefined', async () => {
    vi.stubGlobal('window', undefined);
    const { isTauriRuntime } = await import('../../services/tauriRuntime');
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns false when __TAURI__ is not set on window', async () => {
    vi.stubGlobal('window', {});
    const { isTauriRuntime } = await import('../../services/tauriRuntime');
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true when __TAURI__ is set on window', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    const { isTauriRuntime } = await import('../../services/tauriRuntime');
    expect(isTauriRuntime()).toBe(true);
  });
});

describe('getTauriAppVersion', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when not in Tauri runtime', async () => {
    vi.stubGlobal('window', {});
    const { getTauriAppVersion } = await import('../../services/tauriRuntime');
    await expect(getTauriAppVersion()).resolves.toBeNull();
  });
});

describe('openTauriDataDirectory', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('returns false when not in Tauri runtime', async () => {
    vi.stubGlobal('window', {});
    const { openTauriDataDirectory } = await import('../../services/tauriRuntime');
    await expect(openTauriDataDirectory()).resolves.toBe(false);
  });
});
