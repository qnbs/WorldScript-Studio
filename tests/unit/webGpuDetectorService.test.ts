/**
 * Tests for services/ai/webGpuDetectorService.ts
 * QNBS-v3: Stubs navigator.gpu to cover all detection branches.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectWebGpuDetails } from '../../services/ai/webGpuDetectorService';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectWebGpuDetails', () => {
  it('returns unavailable when navigator has no gpu property', async () => {
    vi.stubGlobal('navigator', {});
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unavailable');
  });

  it('returns unknown when requestAdapter throws', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockRejectedValueOnce(new Error('GPU unavailable')) },
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unknown');
  });

  it('returns unknown when requestAdapter returns null', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(null) },
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unknown');
  });

  it('returns available with high vramTier for large maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 9 * 1024 * 1024 * 1024 }, // 9 GiB → high
      requestAdapterInfo: undefined,
    };
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(mockAdapter) },
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('available');
    expect(result.vramTier).toBe('high');
  });

  it('returns medium vramTier for medium maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 5 * 1024 * 1024 * 1024 }, // 5 GiB → medium
      requestAdapterInfo: undefined,
    };
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(mockAdapter) },
    });
    const result = await detectWebGpuDetails();
    expect(result.vramTier).toBe('medium');
  });

  it('returns low vramTier for small maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 2 * 1024 * 1024 * 1024 }, // 2 GiB → low
      requestAdapterInfo: undefined,
    };
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(mockAdapter) },
    });
    const result = await detectWebGpuDetails();
    expect(result.vramTier).toBe('low');
  });

  it('includes adapterDescription and architecture from requestAdapterInfo', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 8 * 1024 * 1024 * 1024 },
      requestAdapterInfo: vi.fn().mockResolvedValueOnce({
        description: 'Apple M2',
        architecture: 'apple',
        vendor: 'apple',
      }),
    };
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(mockAdapter) },
    });
    const result = await detectWebGpuDetails();
    expect(result.adapterDescription).toBe('Apple M2');
    expect(result.architecture).toBe('apple');
  });

  it('silently ignores error from requestAdapterInfo', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 8 * 1024 * 1024 * 1024 },
      requestAdapterInfo: vi.fn().mockRejectedValueOnce(new Error('Experimental API')),
    };
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValueOnce(mockAdapter) },
    });
    const result = await detectWebGpuDetails();
    // Should still be available without crash
    expect(result.status).toBe('available');
    expect(result.adapterDescription).toBeUndefined();
  });
});
