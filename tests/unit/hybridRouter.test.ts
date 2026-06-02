// QNBS-v3: Tests for hybridRouter — web worker pool vs Rust TaskSupervisor routing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnqueue = vi.fn();
// biome-ignore lint/suspicious/noExplicitAny: mock returns null or partial bus shape
const mockGetWorkerBus = vi.fn<[], any>(() => null);

vi.mock('../../services/workerBusManager', () => ({
  getWorkerBus: mockGetWorkerBus,
}));

const mockIsRustAvailable = vi.fn(async () => false);
const mockInvokeRustTask = vi.fn();
const mockInvalidateCache = vi.fn();

vi.mock('../../services/tauriTaskBridge', () => ({
  isRustComputeAvailable: mockIsRustAvailable,
  invokeRustTask: mockInvokeRustTask,
  invalidateRustAvailabilityCache: mockInvalidateCache,
}));

const mockHandle = {
  taskId: 'bus-task-id',
  result: Promise.resolve({ text: 'generated' }),
  progress: (async function* () {})(),
  cancel: vi.fn(),
};

describe('hybridRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetWorkerBus.mockReturnValue(null);
    mockIsRustAvailable.mockResolvedValue(false);
    mockEnqueue.mockReturnValue(mockHandle);
    mockInvalidateCache.mockReset();
    mockInvokeRustTask.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when WorkerBus is not initialized and Rust is off', async () => {
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask('inference.text', { prompt: 'hi' });
    expect(result).toBeNull();
  });

  it('routes to web worker pool when bus is available', async () => {
    mockGetWorkerBus.mockReturnValue({ enqueue: mockEnqueue });
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask('inference.text', { prompt: 'hi' });
    expect(result).toBe(mockHandle);
    expect(mockEnqueue).toHaveBeenCalledWith('inference.text', { prompt: 'hi' }, { target: 'web' });
  });

  it('routes to Rust when rustComputeEnabled + target:rust + Rust available', async () => {
    mockIsRustAvailable.mockResolvedValue(true);
    mockInvokeRustTask.mockResolvedValue({
      taskId: 'rust-tid',
      success: true,
      payload: { answer: 42 },
      latencyMs: 10,
    });
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask(
      'proforge.stage',
      { doc: '...' },
      {
        target: 'rust',
        rustComputeEnabled: true,
      },
    );
    expect(result).not.toBeNull();
    expect(result?.taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID
    await expect(result!.result).resolves.toEqual({ answer: 42 });
  });

  it('falls back to web worker when Rust is unavailable (target:rust)', async () => {
    mockIsRustAvailable.mockResolvedValue(false);
    mockGetWorkerBus.mockReturnValue({ enqueue: mockEnqueue });
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask(
      'proforge.stage',
      {},
      {
        target: 'rust',
        rustComputeEnabled: true,
      },
    );
    expect(result).toBe(mockHandle);
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('falls back to web worker when Rust invoke throws', async () => {
    mockIsRustAvailable.mockResolvedValue(true);
    mockInvokeRustTask.mockRejectedValue(new Error('IPC error'));
    mockGetWorkerBus.mockReturnValue({ enqueue: mockEnqueue });
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask(
      'inference.text',
      {},
      {
        rustComputeEnabled: true,
      },
    );
    expect(result).toBe(mockHandle);
  });

  it('skips Rust path when rustComputeEnabled is false even if target:rust', async () => {
    mockIsRustAvailable.mockResolvedValue(true);
    mockGetWorkerBus.mockReturnValue({ enqueue: mockEnqueue });
    const { routeTask } = await import('../../services/hybridRouter');
    await routeTask('inference.text', {}, { target: 'rust', rustComputeEnabled: false });
    expect(mockInvokeRustTask).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('Rust result promise rejects when success is false', async () => {
    mockIsRustAvailable.mockResolvedValue(true);
    mockInvokeRustTask.mockResolvedValue({
      taskId: 'rust-fail',
      success: false,
      payload: null,
      error: 'task supervisor error',
      latencyMs: 5,
    });
    const { routeTask } = await import('../../services/hybridRouter');
    const result = await routeTask(
      'inference.text',
      {},
      { target: 'rust', rustComputeEnabled: true },
    );
    await expect(result!.result).rejects.toThrow('task supervisor error');
  });

  it('invalidateRustAvailabilityCache is re-exported', async () => {
    const { invalidateRustAvailabilityCache } = await import('../../services/hybridRouter');
    invalidateRustAvailabilityCache();
    expect(mockInvalidateCache).toHaveBeenCalledOnce();
  });
});
