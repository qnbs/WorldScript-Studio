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

describe('getDesktopOs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when not in Tauri runtime', async () => {
    vi.stubGlobal('window', {});
    const { getDesktopOs } = await import('../../services/tauriRuntime');
    expect(getDesktopOs()).toBeNull();
  });

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
  ])('detects %s → %s', async (userAgent, expected) => {
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', { userAgent });
    const { getDesktopOs } = await import('../../services/tauriRuntime');
    expect(getDesktopOs()).toBe(expected);
  });

  it.each([
    [''],
    ['Some Unknown WebView/1.0'],
    ['SunOS sparc'],
  ])('returns null for unrecognized/empty UA %j (no silent linux misclassification)', async (userAgent) => {
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', { userAgent });
    const { getDesktopOs } = await import('../../services/tauriRuntime');
    expect(getDesktopOs()).toBeNull();
  });
});

describe('applyDesktopRuntimeFlags', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is a no-op on the web (no __TAURI__)', async () => {
    const add = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { body: { classList: { add }, dataset: {} } });
    const { applyDesktopRuntimeFlags } = await import('../../services/tauriRuntime');
    applyDesktopRuntimeFlags();
    expect(add).not.toHaveBeenCalled();
  });

  it('tags the body with is-desktop + data-os under Tauri', async () => {
    const add = vi.fn();
    const dataset: Record<string, string> = {};
    vi.stubGlobal('window', { __TAURI__: {} });
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    vi.stubGlobal('document', { body: { classList: { add }, dataset } });
    const { applyDesktopRuntimeFlags } = await import('../../services/tauriRuntime');
    applyDesktopRuntimeFlags();
    expect(add).toHaveBeenCalledWith('is-desktop');
    expect(dataset['os']).toBe('windows');
  });
});
