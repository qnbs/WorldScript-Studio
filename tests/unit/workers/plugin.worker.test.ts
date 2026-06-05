/**
 * Tests for plugin.worker.ts — Worker isolation for plugin execution.
 * QNBS-v3: P1 tests for P0-2 plugin worker isolation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the worker-bus module
const mockRegisterTaskHandler = vi.fn();
vi.mock('@domain/worker-bus', () => ({
  registerTaskHandler: mockRegisterTaskHandler,
}));

describe('plugin.worker', () => {
  beforeEach(() => {
    mockRegisterTaskHandler.mockClear();
  });

  describe('task registration', () => {
    it('registers plugin.execute and plugin.ping task handlers on module load', async () => {
      // Import the worker module to trigger registration
      await import('../../../workers/plugin.worker', { with: { type: 'script' } });
      // Should have registered both handlers
      expect(mockRegisterTaskHandler).toHaveBeenCalledTimes(2);
      expect(mockRegisterTaskHandler).toHaveBeenCalledWith('plugin.execute', expect.any(Function));
      expect(mockRegisterTaskHandler).toHaveBeenCalledWith('plugin.ping', expect.any(Function));
    });
  });
});
