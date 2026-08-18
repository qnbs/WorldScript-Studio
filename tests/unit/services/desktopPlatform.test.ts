// QNBS-v3: only mocks isTauriRuntime (the one real dependency of desktopPlatform's resolve-once selection) — the two adapters themselves are exercised by their own package tests.
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ isTauri: { value: true } }));
vi.mock('../../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));

describe('desktopPlatform selector', () => {
  it('selects the Tauri adapter when isTauriRuntime() is true', async () => {
    h.isTauri.value = true;
    vi.resetModules();
    const { desktopPlatform } = await import('../../../services/desktopPlatform');
    expect(desktopPlatform.runtime.isDesktop).toBe(true);
  });

  it('selects the web adapter when isTauriRuntime() is false', async () => {
    h.isTauri.value = false;
    vi.resetModules();
    const { desktopPlatform } = await import('../../../services/desktopPlatform');
    expect(desktopPlatform.runtime.isDesktop).toBe(false);
  });
});
