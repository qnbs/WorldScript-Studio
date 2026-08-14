/**
 * Tests for services/tauriMenuService.ts and services/tauriTrayService.ts
 * QNBS-v3: Mocks isTauriRuntime — non-Tauri paths do nothing and don't import Tauri modules.
 */

import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsTauri = false;

vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauri,
}));

// QNBS-v3: capture the registered `listen` callback so tests can simulate native menu events.
// mockListen is a controllable reference (not the default auto-resolving body inline) so the race-
// condition regression test below can defer its resolution to simulate a stale completion.
let capturedMenuListener: ((event: { payload: string }) => void) | null = null;
const mockListen = vi.fn(async (_name: string, cb: (event: { payload: string }) => void) => {
  capturedMenuListener = cb;
  return () => {
    capturedMenuListener = null;
  };
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: Parameters<typeof mockListen>) => mockListen(...args),
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
    mockIsTauri = false;
    unregisterTauriMenuHandler();
  });

  afterEach(() => {
    unregisterTauriMenuHandler();
  });

  it('does nothing when not in Tauri runtime', async () => {
    mockIsTauri = false;
    const handler = vi.fn();
    await expect(registerTauriMenuHandler(handler)).resolves.toBeUndefined();
  });

  it('does not throw even when Tauri listen is unavailable (non-Tauri)', async () => {
    mockIsTauri = false;
    await expect(registerTauriMenuHandler(vi.fn())).resolves.not.toThrow();
  });

  it('routes the new menu-command-palette action to the handler', async () => {
    mockIsTauri = true;
    const handler = vi.fn();
    await registerTauriMenuHandler(handler);
    capturedMenuListener?.({ payload: 'menu-command-palette' });
    expect(handler).toHaveBeenCalledWith('menu-command-palette');
  });

  it('ignores unknown / predefined menu ids (e.g. native undo)', async () => {
    mockIsTauri = true;
    const handler = vi.fn();
    await registerTauriMenuHandler(handler);
    capturedMenuListener?.({ payload: 'undo' });
    expect(handler).not.toHaveBeenCalled();
  });

  // QNBS-v3 (CodeAnt/CodeRabbit #363): registration is async (dynamic import + listen()) — an
  // unregister landing while it's still pending must tear down the stale listener instead of
  // letting its late completion install one anyway (which would survive past "unregistered").
  it('tears down a stale listener whose registration resolves after an unregister', async () => {
    mockIsTauri = true;
    let resolveListen: ((stop: () => void) => void) | undefined;
    const staleStop = vi.fn();
    mockListen.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );

    const registerPromise = registerTauriMenuHandler(vi.fn());
    // Wait for the pending dynamic import + listen() call to actually land before unregistering —
    // otherwise unregister would run before registrationToken has even been captured.
    await waitFor(() => expect(resolveListen).toBeDefined());
    unregisterTauriMenuHandler(); // lands before listen() above resolves
    resolveListen?.(staleStop);
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
    mockIsTauri = false;
  });

  it('does nothing when not in Tauri runtime (visible=true)', async () => {
    mockIsTauri = false;
    await expect(setTauriMainWindowVisible(true)).resolves.toBeUndefined();
  });

  it('does nothing when not in Tauri runtime (visible=false)', async () => {
    mockIsTauri = false;
    await expect(setTauriMainWindowVisible(false)).resolves.toBeUndefined();
  });
});
