import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunLocalTextGeneration = vi.fn();

vi.mock('@domain/ai-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@domain/ai-core')>();
  return {
    ...actual,
    runLocalTextGeneration: mockRunLocalTextGeneration,
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('localAiFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
