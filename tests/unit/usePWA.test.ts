import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePWA } from '../../hooks/usePWA';

beforeEach(() => {
  sessionStorage.clear();
  // Ensure default online state
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  // Clean up storyCraftPWA
  delete (window as { storyCraftPWA?: unknown }).storyCraftPWA;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePWA', () => {
  it('returns initial state correctly', () => {
    const { result } = renderHook(() => usePWA());
    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
    expect(result.current.isUpdateAvailable).toBe(false);
    expect(result.current.isOffline).toBe(false);
  });

  it('sets isOffline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { result } = renderHook(() => usePWA());
    expect(result.current.isOffline).toBe(true);
  });

  it('responds to online/offline window events', () => {
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOffline).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOffline).toBe(false);
  });

  it('sets isInstallable on sw-installable event', () => {
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-installable'));
    });

    expect(result.current.isInstallable).toBe(true);
  });

  it('sets isInstalled and clears isInstallable on sw-installed event', () => {
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-installable'));
    });
    expect(result.current.isInstallable).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-installed'));
    });
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('sets isUpdateAvailable on sw-update-available event', () => {
    const applyUpdate = vi.fn();
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { applyUpdate } }));
    });

    expect(result.current.isUpdateAvailable).toBe(true);
  });

  it('dismissInstall hides install banner and saves to sessionStorage', () => {
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-installable'));
    });
    expect(result.current.isInstallable).toBe(true);

    act(() => {
      result.current.dismissInstall();
    });

    expect(result.current.isInstallable).toBe(false);
    expect(sessionStorage.getItem('pwa-install-dismissed')).toBe('1');
  });

  it('dismissUpdate sets isUpdateAvailable to false', () => {
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('sw-update-available', { detail: { applyUpdate: vi.fn() } }),
      );
    });
    expect(result.current.isUpdateAvailable).toBe(true);

    act(() => {
      result.current.dismissUpdate();
    });
    expect(result.current.isUpdateAvailable).toBe(false);
  });

  it('does not show install banner when already dismissed this session', () => {
    sessionStorage.setItem('pwa-install-dismissed', '1');
    const { result } = renderHook(() => usePWA());

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-installable'));
    });

    // isInstallable should remain false because session-dismissed
    expect(result.current.isInstallable).toBe(false);
  });
});
