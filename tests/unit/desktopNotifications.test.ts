/** Tests for services/desktop/desktopNotifications.ts */
// QNBS-v3: mocks isTauriRuntime + @tauri-apps/plugin-notification to assert the web no-op, permission-check/request flow (including in-flight dedupe), and the send gate.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  isTauri: { value: true },
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async (): Promise<'granted' | 'denied' | 'default'> => 'granted'),
  sendNotification: vi.fn(),
}));

vi.mock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: () => h.isPermissionGranted(),
  requestPermission: () => h.requestPermission(),
  sendNotification: (opts: { title: string; body: string }) => h.sendNotification(opts),
}));

import {
  _resetNotificationStateForTest,
  isNotificationPermissionGranted,
  requestNotificationPermission,
  sendDesktopNotification,
} from '../../services/desktop/desktopNotifications';

describe('desktopNotifications', () => {
  beforeEach(() => {
    h.isTauri.value = true;
    h.isPermissionGranted.mockReset().mockResolvedValue(true);
    h.requestPermission.mockReset().mockResolvedValue('granted');
    h.sendNotification.mockReset();
    _resetNotificationStateForTest();
  });

  describe('isNotificationPermissionGranted', () => {
    it('resolves false on the web without calling the plugin', async () => {
      h.isTauri.value = false;
      await expect(isNotificationPermissionGranted()).resolves.toBe(false);
      expect(h.isPermissionGranted).not.toHaveBeenCalled();
    });

    it('resolves the plugin result in Tauri', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      await expect(isNotificationPermissionGranted()).resolves.toBe(false);
      h.isPermissionGranted.mockResolvedValue(true);
      await expect(isNotificationPermissionGranted()).resolves.toBe(true);
    });

    it('resolves false (never throws) if the plugin call fails', async () => {
      h.isPermissionGranted.mockRejectedValue(new Error('plugin unavailable'));
      await expect(isNotificationPermissionGranted()).resolves.toBe(false);
    });
  });

  describe('requestNotificationPermission', () => {
    it('resolves false on the web without calling the plugin', async () => {
      h.isTauri.value = false;
      await expect(requestNotificationPermission()).resolves.toBe(false);
      expect(h.requestPermission).not.toHaveBeenCalled();
    });

    it('skips requestPermission when already granted', async () => {
      h.isPermissionGranted.mockResolvedValue(true);
      await expect(requestNotificationPermission()).resolves.toBe(true);
      expect(h.requestPermission).not.toHaveBeenCalled();
    });

    it('requests permission and resolves true when granted', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      h.requestPermission.mockResolvedValue('granted');
      await expect(requestNotificationPermission()).resolves.toBe(true);
      expect(h.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('resolves false when the user denies the request', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      h.requestPermission.mockResolvedValue('denied');
      await expect(requestNotificationPermission()).resolves.toBe(false);
    });

    it('dedupes concurrent requests into a single in-flight promise', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      const [a, b] = await Promise.all([
        requestNotificationPermission(),
        requestNotificationPermission(),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(h.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('resolves false (never throws) if the plugin call fails', async () => {
      h.isPermissionGranted.mockRejectedValue(new Error('plugin unavailable'));
      await expect(requestNotificationPermission()).resolves.toBe(false);
    });
  });

  describe('sendDesktopNotification', () => {
    it('resolves false on the web without calling the plugin', async () => {
      h.isTauri.value = false;
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(false);
      expect(h.sendNotification).not.toHaveBeenCalled();
    });

    it('resolves false without sending when permission is not granted', async () => {
      h.isPermissionGranted.mockResolvedValue(false);
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(false);
      expect(h.sendNotification).not.toHaveBeenCalled();
    });

    it('sends the notification and resolves true when permission is granted', async () => {
      h.isPermissionGranted.mockResolvedValue(true);
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(true);
      expect(h.sendNotification).toHaveBeenCalledWith({ title: 'title', body: 'body' });
    });

    it('resolves false (never throws) if the plugin call fails', async () => {
      h.isPermissionGranted.mockResolvedValue(true);
      h.sendNotification.mockImplementation(() => {
        throw new Error('plugin unavailable');
      });
      await expect(sendDesktopNotification('title', 'body')).resolves.toBe(false);
    });
  });
});
