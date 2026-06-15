// QNBS-v3: Tests for tauriTaskBridge — Rust TaskSupervisor Tauri invoke wrapper.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/tauriRuntime', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('tauriTaskBridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('invokeRustTask', () => {
    it('throws when not in Tauri context', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(false);
      const { invokeRustTask } = await import('../../services/tauriTaskBridge');
      await expect(
        invokeRustTask({
          taskId: '00000000-0000-0000-0000-000000000001',
          taskType: 'inference.text',
          payload: { input: 'hello' },
          priority: 'normal',
          target: 'rust',
          timeoutMs: 5000,
        }),
      ).rejects.toThrow('not in Tauri context');
    });

    it('calls Tauri invoke when in Tauri context', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(true);
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockResolvedValue({
        taskId: 'tid-1',
        success: true,
        payload: { result: 'done' },
        latencyMs: 42,
      });
      const { invokeRustTask } = await import('../../services/tauriTaskBridge');
      const result = await invokeRustTask({
        taskId: '00000000-0000-0000-0000-000000000002',
        taskType: 'inference.text',
        payload: { input: 'hello' },
        priority: 'normal',
        target: 'rust',
        timeoutMs: 5000,
      });
      expect(result.success).toBe(true);
      expect(invoke).toHaveBeenCalledWith('worldscript_task_supervisor_submit', expect.any(Object));
    });

    it('wraps Tauri invoke errors with context message', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(true);
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockRejectedValue(new Error('IPC error'));
      const { invokeRustTask } = await import('../../services/tauriTaskBridge');
      await expect(
        invokeRustTask({
          taskId: '00000000-0000-0000-0000-000000000003',
          taskType: 'inference.text',
          payload: {},
          priority: 'normal',
          target: 'rust',
          timeoutMs: 5000,
        }),
      ).rejects.toThrow('Rust TaskSupervisor failed');
    });
  });

  describe('isRustComputeAvailable', () => {
    it('returns false when not in Tauri context', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(false);
      const { isRustComputeAvailable } = await import('../../services/tauriTaskBridge');
      expect(await isRustComputeAvailable()).toBe(false);
    });

    it('returns true when ping succeeds', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(true);
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockResolvedValue(undefined);
      const { isRustComputeAvailable, invalidateRustAvailabilityCache } = await import(
        '../../services/tauriTaskBridge'
      );
      invalidateRustAvailabilityCache();
      expect(await isRustComputeAvailable()).toBe(true);
    });

    it('returns false when ping throws', async () => {
      const { isTauriRuntime } = await import('../../services/tauriRuntime');
      vi.mocked(isTauriRuntime).mockReturnValue(true);
      const { invoke } = await import('@tauri-apps/api/core');
      vi.mocked(invoke).mockRejectedValue(new Error('command not found'));
      const { isRustComputeAvailable, invalidateRustAvailabilityCache } = await import(
        '../../services/tauriTaskBridge'
      );
      invalidateRustAvailabilityCache();
      expect(await isRustComputeAvailable()).toBe(false);
    });
  });
});
