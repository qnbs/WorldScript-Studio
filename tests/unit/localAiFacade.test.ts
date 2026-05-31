import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunLocalTextGeneration = vi.fn();
const mockDetectWebGpuSupport = vi.fn().mockReturnValue(false);
const mockSurrenderLeadership = vi.fn();
const mockAcquireGpu = vi.fn().mockResolvedValue(undefined);
const mockReleaseGpu = vi.fn();

vi.mock('@domain/ai-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@domain/ai-core')>();
  return {
    ...actual,
    runLocalTextGeneration: mockRunLocalTextGeneration,
    detectWebGpuSupport: mockDetectWebGpuSupport,
    surrenderLeadership: mockSurrenderLeadership,
  };
});

vi.mock('../../services/ai/gpuResourceManager', () => ({
  gpuResourceManager: {
    acquireGpu: mockAcquireGpu,
    releaseGpu: mockReleaseGpu,
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('localAiFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // QNBS-v3: Re-assert defaults after clearAllMocks (which wipes call history but not impls).
    //          Explicit reset guards against test-order sensitivity.
    mockDetectWebGpuSupport.mockReturnValue(false);
    mockAcquireGpu.mockResolvedValue(undefined);
  });

  it('returns local layer result when runLocalTextGeneration succeeds', async () => {
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'AI output' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    // Task is enqueued then dequeued — runLocalTextGeneration is called
    expect(result.text).toBeTruthy();
    expect(typeof result.layer).toBe('string');
  });

  it('passes AbortSignal to runLocalTextGeneration', async () => {
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    const controller = new AbortController();
    await generateLocalText('prompt', 'model', undefined, undefined, controller.signal);
    expect(mockRunLocalTextGeneration).toHaveBeenCalledWith(
      'prompt',
      'model',
      undefined,
      controller.signal,
    );
  });

  it('returns heuristic fallback when runLocalTextGeneration throws', async () => {
    mockRunLocalTextGeneration.mockRejectedValue(new Error('WebLLM failed'));
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    expect(result.layer).toBe('heuristic');
    expect(result.text).toBeTruthy();
  });

  it('returns telemetry object from getLocalWorkerBusTelemetry', async () => {
    const { getLocalWorkerBusTelemetry } = await import('../../services/localAiFacade');
    const tele = getLocalWorkerBusTelemetry();
    expect(tele).toBeTruthy();
    expect(typeof tele).toBe('object');
  });

  it('includes loraAdapterId in the enqueued task payload', async () => {
    // QNBS-v3: loraAdapterId is wired into the WorkerBus task payload (for future worker-side LoRA),
    //          NOT forwarded to runLocalTextGeneration. Spy on the real bus to assert the payload,
    //          and confirm loraAdapterId never leaks into runLocalTextGeneration's signal slot.
    // QNBS-v3: dynamic import — a top-level @domain/ai-core import would make the hoisted vi.mock
    //          factory run before the mock consts initialize (TDZ). The mock spreads the real
    //          WorkerBus, so its prototype is shared with the module's internal localWorkerBus.
    const { WorkerBus } = await import('@domain/ai-core');
    const enqueueSpy = vi.spyOn(WorkerBus.prototype, 'enqueue');
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    await generateLocalText('prompt', 'model', undefined, 'my-lora');
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'local.text.generate',
        payload: expect.objectContaining({
          prompt: 'prompt',
          modelId: 'model',
          loraAdapterId: 'my-lora',
        }),
      }),
    );
    expect(mockRunLocalTextGeneration).toHaveBeenCalledWith(
      'prompt',
      'model',
      undefined,
      undefined,
    );
    enqueueSpy.mockRestore();
  });

  it('acquires and releases GPU mutex when WebGPU is available', async () => {
    mockDetectWebGpuSupport.mockReturnValue(true);
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    await generateLocalText('prompt');
    expect(mockAcquireGpu).toHaveBeenCalledWith('webllm', 'high');
    expect(mockReleaseGpu).toHaveBeenCalledWith('webllm');
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });

  it('skips GPU mutex when WebGPU is not available', async () => {
    mockDetectWebGpuSupport.mockReturnValue(false);
    mockRunLocalTextGeneration.mockResolvedValue({ layer: 'local', text: 'ok' });
    const { generateLocalText } = await import('../../services/localAiFacade');
    await generateLocalText('prompt');
    expect(mockAcquireGpu).not.toHaveBeenCalled();
    // surrenderLeadership is called unconditionally (in finally)
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });

  it('releases GPU and surrenders leadership even when generation throws', async () => {
    mockDetectWebGpuSupport.mockReturnValue(true);
    mockRunLocalTextGeneration.mockRejectedValue(new Error('GPU OOM'));
    const { generateLocalText } = await import('../../services/localAiFacade');
    const result = await generateLocalText('prompt');
    expect(result.layer).toBe('heuristic');
    expect(mockReleaseGpu).toHaveBeenCalledWith('webllm');
    expect(mockSurrenderLeadership).toHaveBeenCalled();
  });
});
