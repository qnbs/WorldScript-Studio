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

  it('returns false when neither Tauri global is set on window', async () => {
    vi.stubGlobal('window', {});
    const { isTauriRuntime } = await import('../../services/tauriRuntime');
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true when __TAURI__ is set on window (withGlobalTauri)', async () => {
    vi.stubGlobal('window', { __TAURI__: {} });
    const { isTauriRuntime } = await import('../../services/tauriRuntime');
    expect(isTauriRuntime()).toBe(true);
  });

  // QNBS-v3 (T0): the real desktop shell exposes `__TAURI_INTERNALS__` (always) but not `__TAURI__`
  // unless withGlobalTauri is on — which this app does not set. Detection must accept it.
  it('returns true when only __TAURI_INTERNALS__ is set (real Tauri v2 shell)', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
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
