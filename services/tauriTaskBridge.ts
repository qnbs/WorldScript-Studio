// QNBS-v3: Phase 2 — Tauri bridge for Rust TaskSupervisor. Requires Tauri 2 + the Rust command
//          `worldscript_task_supervisor_submit` and `worldscript_task_supervisor_ping` registered in
//          src-tauri/src/commands/task_supervisor.rs. Gracefully unavailable in web-browser context.

import type { RustTaskRequest, RustTaskResultEvent } from '@domain/worker-bus';
import { desktopPlatform } from './desktopPlatform';
import { createLogger } from './logger';

const log = createLogger('tauriTaskBridge');

/**
 * Submit a task to the Rust TaskSupervisor via Tauri invoke.
 * Throws if not in a Tauri context or if the Rust command is unavailable.
 */
export async function invokeRustTask(request: RustTaskRequest): Promise<RustTaskResultEvent> {
  if (!desktopPlatform.runtime.isDesktop) {
    throw new Error('[tauriTaskBridge] Rust compute unavailable — not in Tauri context');
  }
  try {
    // QNBS-v3: submits through desktopPlatform.tasks instead of the direct @tauri-apps/api/core invoke() it replaced
    const result = await desktopPlatform.tasks.submitTask(request);
    log.info('Rust TaskSupervisor completed task', {
      taskId: request.taskId,
      taskType: request.taskType,
    });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[tauriTaskBridge] Rust TaskSupervisor failed: ${msg}`);
  }
}

// QNBS-v3: TTL cache so the ping is not repeated on every route call.
let _rustAvailableCache: { value: boolean; checkedAt: number } | null = null;
const RUST_CHECK_TTL_MS = 60_000;

/**
 * Check whether the Rust TaskSupervisor command is registered and reachable.
 * Result is cached for RUST_CHECK_TTL_MS to avoid repeated IPC round-trips.
 */
export async function isRustComputeAvailable(): Promise<boolean> {
  if (!desktopPlatform.runtime.isDesktop) return false;
  const now = Date.now();
  if (_rustAvailableCache !== null && now - _rustAvailableCache.checkedAt < RUST_CHECK_TTL_MS) {
    return _rustAvailableCache.value;
  }
  try {
    await desktopPlatform.tasks.pingSupervisor();
    _rustAvailableCache = { value: true, checkedAt: now };
    return true;
  } catch {
    _rustAvailableCache = { value: false, checkedAt: now };
    return false;
  }
}

/** Force-invalidate the Rust availability cache (e.g. after flag toggle). */
export function invalidateRustAvailabilityCache(): void {
  _rustAvailableCache = null;
}
