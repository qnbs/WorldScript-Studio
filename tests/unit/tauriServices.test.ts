/**
 * Tests for services/tauriMenuService.ts and services/tauriTrayService.ts
 * QNBS-v3: Wave 1 — mocks services/desktopPlatform (not @tauri-apps/* / isTauriRuntime directly);
 * the Tauri-vs-web decision now lives in desktopPlatform's adapter selection.
 */

import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsDesktop = false;

// QNBS-v3: capture the registered onMenuAction callback so tests can simulate native menu events.
// mockOnMenuAction is a controllable reference (not the default auto-resolving body inline) so the
// race-condition regression test below can defer its resolution to simulate a stale completion.
let capturedMenuListener: ((id: string) => void) | null = null;
const mockOnMenuAction = vi.fn(async (cb: (id: string) => void) => {
  capturedMenuListener = cb;
  return () => {
    capturedMenuListener = null;
  };
});
const mockShow = vi.fn(async () => {});
const mockHide = vi.fn(async () => {});
const mockSetFocus = vi.fn(async () => {});

vi.mock('../../services/desktopPlatform', () => ({
  get desktopPlatform() {
    return {
      runtime: {
        get isDesktop() {
          return mockIsDesktop;
        },
        os: null,
      },
      menu: { onMenuAction: (cb: (id: string) => void) => mockOnMenuAction(cb) },
      window: { show: mockShow, hide: mockHide, setFocus: mockSetFocus },
    };
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  registerTauriMenuHandler,
  unregisterTauriMenuHandler,
} from '../../services/tauriMenuService';
import { setTauriMainWindowVisible } from '../../services/tauriTrayService';

// ---------------------------------------------------------------------------
// tauriMenuService tests
// ---------------------------------------------------------------------------

describe('registerTauriMenuHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDesktop = false;
    unregisterTauriMenuHandler();
  });

  afterEach(() => {
    unregisterTauriMenuHandler();
  });

  it('does nothing when not in Tauri runtime', async () => {
    mockIsDesktop = false;
    const handler = vi.fn();
    await expect(registerTauriMenuHandler(handler)).resolves.toBeUndefined();
  });

  it('does not throw even when the menu facet is unavailable (non-Tauri)', async () => {
    mockIsDesktop = false;
    await expect(registerTauriMenuHandler(vi.fn())).resolves.not.toThrow();
  });

  it('routes the new menu-command-palette action to the handler', async () => {
    mockIsDesktop = true;
    const handler = vi.fn();
    await registerTauriMenuHandler(handler);
    capturedMenuListener?.('menu-command-palette');
    expect(handler).toHaveBeenCalledWith('menu-command-palette');
  });

  it('ignores unknown / predefined menu ids (e.g. native undo)', async () => {
    mockIsDesktop = true;
    const handler = vi.fn();
    await registerTauriMenuHandler(handler);
    capturedMenuListener?.('undo');
    expect(handler).not.toHaveBeenCalled();
  });

  // QNBS-v3 (CodeAnt/CodeRabbit #363): registration is async (onMenuAction() subscription) — an
  // unregister landing while it's still pending must tear down the stale listener instead of
  // letting its late completion install one anyway (which would survive past "unregistered").
  it('tears down a stale listener whose registration resolves after an unregister', async () => {
    mockIsDesktop = true;
    let resolveOnMenuAction: ((stop: () => void) => void) | undefined;
    const staleStop = vi.fn();
    mockOnMenuAction.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          resolveOnMenuAction = resolve;
        }),
    );

    const registerPromise = registerTauriMenuHandler(vi.fn());
    // Wait for the pending onMenuAction() subscription to actually land before unregistering —
    // otherwise unregister would run before registrationToken has even been captured.
    await waitFor(() => expect(resolveOnMenuAction).toBeDefined());
    unregisterTauriMenuHandler(); // lands before onMenuAction() above resolves
    resolveOnMenuAction?.(staleStop);
    await registerPromise;

    expect(staleStop).toHaveBeenCalledTimes(1);
  });
});

describe('unregisterTauriMenuHandler', () => {
  it('calls unlisten if set and does not throw', () => {
    expect(() => unregisterTauriMenuHandler()).not.toThrow();
  });

  it('can be called multiple times without error', () => {
    unregisterTauriMenuHandler();
    unregisterTauriMenuHandler();
  });
});

// ---------------------------------------------------------------------------
// tauriTrayService tests
// ---------------------------------------------------------------------------

describe('setTauriMainWindowVisible', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDesktop = false;
  });

  it('resolves without throwing (visible=true)', async () => {
    await expect(setTauriMainWindowVisible(true)).resolves.toBeUndefined();
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockSetFocus).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing (visible=false)', async () => {
    await expect(setTauriMainWindowVisible(false)).resolves.toBeUndefined();
    expect(mockHide).toHaveBeenCalledTimes(1);
  });

  it('swallows a window-facet failure instead of throwing', async () => {
    mockShow.mockRejectedValueOnce(new Error('window API unavailable'));
    await expect(setTauriMainWindowVisible(true)).resolves.toBeUndefined();
  });
});
