/**
 * Tests for services/tauriMenuService.ts and services/tauriTrayService.ts
 * QNBS-v3: Mocks isTauriRuntime — non-Tauri paths do nothing and don't import Tauri modules.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsTauri = false;

vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauri,
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
