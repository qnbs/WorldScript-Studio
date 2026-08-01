/**
 * Tests for hooks/useNativeNotifications.ts
 * QNBS-v3 (T3): Mocks useAppSelector + isTauriRuntime + requestNotificationPermission — asserts the
 * hook only requests OS permission when both Tauri and the `desktop.desktopNotifications` setting are
 * true, and never prompts on the web or while the setting is off.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isTauri: { value: true },
  desktopNotifications: { value: false },
  requestNotificationPermission: vi.fn(async () => true),
}));

vi.mock('../../app/hooks', () => ({
  useAppSelector: <T>(
    selector: (s: { settings: { desktop?: { desktopNotifications: boolean } } }) => T,
  ) => selector({ settings: { desktop: { desktopNotifications: h.desktopNotifications.value } } }),
}));
vi.mock('../../services/desktop/desktopNotifications', () => ({
  requestNotificationPermission: () => h.requestNotificationPermission(),
}));
vi.mock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));

import { useNativeNotifications } from '../../hooks/useNativeNotifications';

describe('useNativeNotifications', () => {
  beforeEach(() => {
    h.isTauri.value = true;
    h.desktopNotifications.value = false;
    h.requestNotificationPermission.mockClear();
  });

  it('does not request permission on the web even when the setting is on', () => {
    h.isTauri.value = false;
    h.desktopNotifications.value = true;
    renderHook(() => useNativeNotifications());
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('does not request permission in Tauri when the setting is off', () => {
    h.desktopNotifications.value = false;
    renderHook(() => useNativeNotifications());
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('requests permission in Tauri when the setting is on', () => {
    h.desktopNotifications.value = true;
    renderHook(() => useNativeNotifications());
    expect(h.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('requests permission again when the setting flips from off to on', () => {
    const { rerender } = renderHook(() => useNativeNotifications());
    expect(h.requestNotificationPermission).not.toHaveBeenCalled();
    h.desktopNotifications.value = true;
    rerender();
    expect(h.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });
});
