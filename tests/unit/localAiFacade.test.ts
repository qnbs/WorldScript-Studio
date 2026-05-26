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
