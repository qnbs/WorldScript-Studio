/**
 * Tests for hooks/useTauriUpdater.ts
 * QNBS-v3: Mocks isTauriRuntime + Tauri plugin-updater/api/app to test
 * checkForUpdate, installUpdate, and autoCheck behaviour.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsTauri = false;

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => mockIsTauri,
}));

const mockGetVersion = vi.fn().mockResolvedValue('1.0.0');
const mockCheck = vi.fn();
const mockDownloadAndInstall = vi.fn().mockResolvedValue(undefined);
const mockRelaunch = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: (...args: unknown[]) => mockGetVersion(...args),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: (...args: unknown[]) => mockCheck(...args),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: (...args: unknown[]) => mockRelaunch(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useTauriUpdater } from '../../../hooks/useTauriUpdater';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTauriUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri = false;
  });

  it('returns isDesktop=false when not in Tauri', () => {
    const { result } = renderHook(() => useTauriUpdater());
    expect(result.current.isDesktop).toBe(false);
  });

  it('returns isDesktop=true when in Tauri', () => {
    mockIsTauri = true;
    const { result } = renderHook(() => useTauriUpdater());
    expect(result.current.isDesktop).toBe(true);
  });

  it('initial state: update=null, checking=false, installing=false, error=null', () => {
    const { result } = renderHook(() => useTauriUpdater());
    expect(result.current.update).toBeNull();
    expect(result.current.checking).toBe(false);
    expect(result.current.installing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('checkForUpdate does nothing when not in Tauri', async () => {
    mockIsTauri = false;
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(mockGetVersion).not.toHaveBeenCalled();
    expect(result.current.update).toBeNull();
  });

  it('sets update.available=true when check returns a pending update', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce({
      version: '2.0.0',
      downloadAndInstall: mockDownloadAndInstall,
    });
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.update).toEqual({
      version: '2.0.0',
      currentVersion: '1.0.0',
      available: true,
    });
    expect(result.current.checking).toBe(false);
  });

  it('sets update.available=false when no update is available', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.update?.available).toBe(false);
    expect(result.current.update?.version).toBe('1.0.0');
  });

  it('sets error when checkForUpdate throws', async () => {
    mockIsTauri = true;
    mockCheck.mockRejectedValueOnce(new Error('Network error'));
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.checkForUpdate();
    });
    expect(result.current.error).toBe('Network error');
    expect(result.current.update).toBeNull();
  });

  it('installUpdate does nothing when not in Tauri', async () => {
    mockIsTauri = false;
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.installUpdate();
    });
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it('downloads + relaunches when installUpdate finds a pending update', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce({
      version: '2.0.0',
      downloadAndInstall: mockDownloadAndInstall,
    });
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.installUpdate();
    });
    expect(mockDownloadAndInstall).toHaveBeenCalled();
    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('sets installing=false after successful install', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce({
      version: '2.0.0',
      downloadAndInstall: mockDownloadAndInstall,
    });
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.installUpdate();
    });
    expect(result.current.installing).toBe(false);
  });

  it('sets error when installUpdate throws', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce({
      version: '2.0.0',
      downloadAndInstall: vi.fn().mockRejectedValueOnce(new Error('Install fail')),
    });
    const { result } = renderHook(() => useTauriUpdater());
    await act(async () => {
      await result.current.installUpdate();
    });
    expect(result.current.error).toBe('Install fail');
  });

  it('does not call checkForUpdate on mount when autoCheck=false', () => {
    mockIsTauri = true;
    renderHook(() => useTauriUpdater({ autoCheck: false }));
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('calls checkForUpdate on mount when autoCheck=true and in Tauri', async () => {
    mockIsTauri = true;
    mockCheck.mockResolvedValueOnce(null);
    await act(async () => {
      renderHook(() => useTauriUpdater({ autoCheck: true }));
      await Promise.resolve();
    });
    expect(mockCheck).toHaveBeenCalled();
  });
});
