/**
 * QNBS-v3 (T3): Native OS notifications for background-task completion, built in JS via
 * `@tauri-apps/plugin-notification` (ADR-D1 — native surfaces built in JS, not Rust).
 *
 * Every call is gated by three independent conditions: Tauri runtime (`isTauriRuntime()`), the
 * user's `desktop.desktopNotifications` setting (checked by callers before invoking `notify`), and
 * the OS permission actually being granted. No-op on the web and never throws — a notification
 * failure must not break the calling flow (export, backup, pipeline, updater).
 */

import { desktopPlatform } from '../desktopPlatform';
import { createLogger } from '../logger';

const log = createLogger('desktop-notifications');

// QNBS-v3: dedupe concurrent permission requests — shares the resolved value across racing callers on startup.
let permissionRequestInFlight: Promise<boolean> | null = null;

/** @internal test-only reset for the in-flight guard. */
export function _resetNotificationStateForTest(): void {
  permissionRequestInFlight = null;
}

/**
 * Returns whether OS notification permission is currently granted. Always `false` on the web or if
 * the plugin call fails (never throws).
 */
export async function isNotificationPermissionGranted(): Promise<boolean> {
  try {
    // QNBS-v3: no separate isTauriRuntime() guard needed — desktopPlatform.notifications already resolves to a safe false-returning no-op on web
    return await desktopPlatform.notifications.isPermissionGranted();
  } catch (error) {
    log.warn('Failed to read notification permission state', { error: String(error) });
    return false;
  }
}

/**
 * Requests OS notification permission if not already granted. Concurrent calls share the same
 * in-flight request and resolve to the same result. Returns `false` on the web, when the user
 * previously denied the request, or on any plugin failure.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (permissionRequestInFlight) return permissionRequestInFlight;

  permissionRequestInFlight = (async () => {
    try {
      return await desktopPlatform.notifications.requestPermission();
    } catch (error) {
      log.warn('Failed to request notification permission', { error: String(error) });
      return false;
    } finally {
      permissionRequestInFlight = null;
    }
  })();

  return permissionRequestInFlight;
}

/**
 * Sends a native OS notification. Fire-and-forget: resolves `false` (never throws) on the web, when
 * permission isn't granted, or on any plugin failure. Callers are responsible for checking the
 * `desktop.desktopNotifications` user setting before calling this.
 */
export async function sendDesktopNotification(title: string, body: string): Promise<boolean> {
  try {
    return await desktopPlatform.notifications.send(title, body);
  } catch (error) {
    log.warn('Failed to send desktop notification', { error: String(error) });
    return false;
  }
}
