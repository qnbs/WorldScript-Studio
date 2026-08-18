/** Tests for services/desktop/desktopNotifications.ts */
// QNBS-v3: Wave 1 — mocks services/desktopPlatform (not @tauri-apps/plugin-notification directly)
// since the Tauri-vs-web decision now lives in desktopPlatform's adapter selection (covered by
// packages/desktop-contracts' own tests + tests/unit/services/desktopPlatform.test.ts). This file
// only needs to assert its own remaining responsibilities: error-swallowing and in-flight dedupe.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => true),
  send: vi.fn(async (_title: string, _body: string) => true),
}));

vi.mock('../../services/desktopPlatform', () => ({
  desktopPlatform: {
    notifications: {
      isPermissionGranted: () => h.isPermissionGranted(),
      requestPermission: () => h.requestPermission(),
      send: (title: string, body: string) => h.send(title, body),
    },
  },
}));

import {
  _resetNotificationStateForTest,
  isNotificationPermissionGranted,
  requestNotificationPermission,
  sendDesktopNotification,
} from '../../services/desktop/desktopNotifications';

describe('desktopNotifications', () => {
  beforeEach(() => {
    h.isPermissionGranted.mockReset().mockResolvedValue(true);
    h.requestPermission.mockReset().mockResolvedValue(true);
    h.send.mockReset().mockResolvedValue(true);
    _resetNotificationStateForTest();
  });

  describe('isNotificationPermissionGranted', () => {
    it('resolves the platform result', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      await expect(isNotificationPermissionGranted()).resolves.toBe(false);
      h.isPermissionGranted.mockResolvedValue(true);
      await expect(isNotificationPermissionGranted()).resolves.toBe(true);
    });

    it('resolves false (never throws) if the platform call fails', async () => {
      h.isPermissionGranted.mockRejectedValue(new Error('plugin unavailable'));
      await expect(isNotificationPermissionGranted()).resolves.toBe(false);
    });
  });

  describe('requestNotificationPermission', () => {
    it('resolves the platform result', async () => {
      h.requestPermission.mockResolvedValue(true);
      await expect(requestNotificationPermission()).resolves.toBe(true);
      expect(h.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('resolves false when the platform denies the request', async () => {
      h.requestPermission.mockResolvedValue(false);
      await expect(requestNotificationPermission()).resolves.toBe(false);
    });

    it('dedupes concurrent requests into a single in-flight promise', async () => {
      const holder: { resolveRequest: ((value: boolean) => void) | null } = {
        resolveRequest: null,
      };
      h.requestPermission.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            holder.resolveRequest = resolve;
          }),
      );
      const pending = Promise.all([
        requestNotificationPermission(),
        requestNotificationPermission(),
      ]);
      holder.resolveRequest?.(true);
      const [a, b] = await pending;
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(h.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('resolves false (never throws) if the platform call fails', async () => {
      h.requestPermission.mockRejectedValue(new Error('plugin unavailable'));
      await expect(requestNotificationPermission()).resolves.toBe(false);
    });
  });

  describe('sendDesktopNotification', () => {
    it('delegates to the platform and resolves its result', async () => {
      h.send.mockResolvedValue(true);
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(true);
      expect(h.send).toHaveBeenCalledWith('title', 'body');
    });

    it('resolves false without throwing when the platform denies/fails to send', async () => {
      h.send.mockResolvedValue(false);
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(false);
    });

    it('resolves false (never throws) if the platform call rejects', async () => {
      h.send.mockRejectedValue(new Error('plugin unavailable'));
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(false);
    });
  });
});
