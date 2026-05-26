/**
 * Tests for services/ai/webGpuDetectorService.ts
 * QNBS-v3: Mocks navigator.gpu; tests unavailable, unknown (null adapter), and available paths.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectWebGpuDetails } from '../../../services/ai/webGpuDetectorService';

describe('detectWebGpuDetails', () => {
  const originalNav = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNav,
      writable: true,
      configurable: true,
    });
  });

  it('returns unavailable when navigator has no gpu', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unavailable');
  });

  it('returns unknown when requestAdapter throws', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: {
          requestAdapter: vi.fn().mockRejectedValue(new Error('no adapter')),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unknown');
  });

  it('returns unknown when requestAdapter returns null', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue(null),
        },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('unknown');
  });

  it('returns available with high vramTier for large maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 8 * 1024 * 1024 * 1024 + 1 },
      requestAdapterInfo: vi.fn().mockResolvedValue(null),
    };
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('available');
    expect(result.vramTier).toBe('high');
  });

  it('returns medium vramTier for 4 GiB maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 4 * 1024 * 1024 * 1024 },
      requestAdapterInfo: vi.fn().mockResolvedValue(null),
    };
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.vramTier).toBe('medium');
  });

  it('returns low vramTier for small maxBufferSize', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 512 * 1024 * 1024 },
      requestAdapterInfo: vi.fn().mockResolvedValue(null),
    };
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.vramTier).toBe('low');
  });

  it('populates adapterDescription and architecture from requestAdapterInfo', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 4 * 1024 * 1024 * 1024 },
      requestAdapterInfo: vi.fn().mockResolvedValue({
        description: 'NVIDIA RTX 4090',
        architecture: 'Ada Lovelace',
      }),
    };
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.adapterDescription).toBe('NVIDIA RTX 4090');
    expect(result.architecture).toBe('Ada Lovelace');
  });

  it('handles missing requestAdapterInfo gracefully', async () => {
    const mockAdapter = {
      limits: { maxBufferSize: 2 * 1024 * 1024 * 1024 },
      // no requestAdapterInfo
    };
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      },
      writable: true,
      configurable: true,
    });
    const result = await detectWebGpuDetails();
    expect(result.status).toBe('available');
    expect(result.adapterDescription).toBeUndefined();
  });
});
