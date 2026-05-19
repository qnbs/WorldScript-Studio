import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpuConsumer } from '../../services/ai/gpuResourceManager';

// QNBS-v3: Fresh module import per test (via vi.resetModules + dynamic import) isolates
//          singleton state without needing to expose the class constructor.

describe('GpuResourceManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function fresh() {
    const { gpuResourceManager } = await import('../../services/ai/gpuResourceManager');
    return gpuResourceManager;
  }

  it('acquireGpu resolves immediately when free', async () => {
    const mgr = await fresh();
    let resolved = false;
    void mgr.acquireGpu('webllm', 'normal').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(true);
    expect(mgr.getQueueState().current).toBe('webllm');
  });

  it('second acquireGpu waits until first is released', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');

    let secondResolved = false;
    void mgr.acquireGpu('onnx-webgpu', 'normal').then(() => {
      secondResolved = true;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false); // still waiting

    mgr.releaseGpu('webllm');
    await Promise.resolve();
    await Promise.resolve(); // flush microtask queue
    expect(secondResolved).toBe(true);
    expect(mgr.getQueueState().current).toBe('onnx-webgpu');
  });

  it('higher-priority consumer is granted first when multiple are queued', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');

    const order: GpuConsumer[] = [];
    void mgr.acquireGpu('onnx-webgpu', 'low').then(() => order.push('onnx-webgpu'));
    void mgr.acquireGpu('webllm', 'high').then(() => order.push('webllm'));

    mgr.releaseGpu('webllm');
    await Promise.resolve();
    await Promise.resolve();
    mgr.releaseGpu('webllm');
    await Promise.resolve();
    await Promise.resolve();

    // high-priority 'webllm' should have been granted before low-priority 'onnx-webgpu'
    expect(order[0]).toBe('webllm');
    expect(order[1]).toBe('onnx-webgpu');
  });

  it('releaseGpu from wrong consumer is a no-op', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');
    mgr.releaseGpu('onnx-webgpu'); // wrong consumer
    expect(mgr.getQueueState().current).toBe('webllm');
  });

  it('getQueueState reflects current holder and waiting queue', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');
    void mgr.acquireGpu('onnx-webgpu', 'normal');

    const state = mgr.getQueueState();
    expect(state.current).toBe('webllm');
    expect(state.queue).toContain('onnx-webgpu');
  });

  it('auto-release fires after 30 seconds and grants next consumer', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');

    let nextResolved = false;
    void mgr.acquireGpu('onnx-webgpu', 'normal').then(() => {
      nextResolved = true;
    });

    // Advance time past auto-release threshold
    vi.advanceTimersByTime(30_001);
    await Promise.resolve();
    await Promise.resolve();

    expect(nextResolved).toBe(true);
    expect(mgr.getQueueState().current).toBe('onnx-webgpu');
  });

  it('releaseGpu clears auto-release timer (does not fire after explicit release)', async () => {
    const mgr = await fresh();
    await mgr.acquireGpu('webllm', 'normal');
    mgr.releaseGpu('webllm');

    // Advance time — should not trigger double-release
    vi.advanceTimersByTime(30_001);
    await Promise.resolve();

    // Still free (no crash or double-free)
    expect(mgr.getQueueState().current).toBeNull();
  });

  it('queue is empty and current is null initially', async () => {
    const mgr = await fresh();
    const state = mgr.getQueueState();
    expect(state.current).toBeNull();
    expect(state.queue).toHaveLength(0);
  });
});
