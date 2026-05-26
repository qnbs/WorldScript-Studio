/**
 * Tests for services/ai/gpuResourceManager.ts
 * QNBS-v3: Priority queue, acquire/release, auto-release timer, getQueueState.
 * Uses fake timers to test auto-release without real 30s delays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Re-import fresh singleton each time by resetting module registry
describe('gpuResourceManager', () => {
  let gpuResourceManager: typeof import('../../../services/ai/gpuResourceManager').gpuResourceManager;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../../../services/ai/gpuResourceManager');
    gpuResourceManager = mod.gpuResourceManager;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('acquires immediately when idle', async () => {
    await expect(gpuResourceManager.acquireGpu('webllm')).resolves.toBeUndefined();
  });

  it('getQueueState shows current consumer after acquire', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    const state = gpuResourceManager.getQueueState();
    expect(state.current).toBe('webllm');
    expect(state.queue).toHaveLength(0);
  });

  it('releases current consumer correctly', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    gpuResourceManager.releaseGpu('webllm');
    const state = gpuResourceManager.getQueueState();
    expect(state.current).toBeNull();
  });

  it('queues second consumer while first holds GPU', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    // Second consumer goes into queue
    const p2 = gpuResourceManager.acquireGpu('onnx-webgpu');
    const state = gpuResourceManager.getQueueState();
    expect(state.current).toBe('webllm');
    expect(state.queue).toContain('onnx-webgpu');
    // Release to avoid hanging
    gpuResourceManager.releaseGpu('webllm');
    await p2;
  });

  it('grants queued consumer after release', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    let granted = false;
    const p2 = gpuResourceManager.acquireGpu('onnx-webgpu').then(() => {
      granted = true;
    });
    gpuResourceManager.releaseGpu('webllm');
    await p2;
    expect(granted).toBe(true);
    expect(gpuResourceManager.getQueueState().current).toBe('onnx-webgpu');
  });

  it('high-priority consumer is granted before normal-priority', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    const order: string[] = [];
    const p1 = gpuResourceManager.acquireGpu('onnx-webgpu', 'normal').then(() => {
      order.push('onnx-normal');
      gpuResourceManager.releaseGpu('onnx-webgpu');
    });
    const p2 = gpuResourceManager.acquireGpu('webllm', 'high').then(() => {
      order.push('webllm-high');
      gpuResourceManager.releaseGpu('webllm');
    });
    gpuResourceManager.releaseGpu('webllm');
    await Promise.all([p1, p2]);
    expect(order[0]).toBe('webllm-high');
    expect(order[1]).toBe('onnx-normal');
  });

  it('ignores releaseGpu from non-current consumer', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    // releasing 'onnx-webgpu' when 'webllm' holds it should be a no-op
    gpuResourceManager.releaseGpu('onnx-webgpu');
    expect(gpuResourceManager.getQueueState().current).toBe('webllm');
    // Clean up
    gpuResourceManager.releaseGpu('webllm');
  });

  it('auto-releases after 30s timeout', async () => {
    await gpuResourceManager.acquireGpu('webllm');
    expect(gpuResourceManager.getQueueState().current).toBe('webllm');
    // Advance fake timers by 30s
    await vi.runAllTimersAsync();
    expect(gpuResourceManager.getQueueState().current).toBeNull();
  });
});
