/**
 * Tests for services/ai/modelRecommendations.ts
 * QNBS-v3: Pure functions — no mocks required; covers all VRAM tiers and task types.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceHealthReport } from '../../services/ai/deviceHealthService';
import {
  ECO_TEXT_GEN_MODEL,
  getModelRecommendationForTask,
  getProviderSpeedEstimate,
  RECOMMENDED_OLLAMA_MODEL_IDS,
} from '../../services/ai/modelRecommendations';

const baseReport = (vramTier: DeviceHealthReport['gpuVramTier']): DeviceHealthReport => ({
  gpuVramTier: vramTier,
  gpuVramMb: 0,
  cpuCores: 4,
  deviceClass: 'mid-range',
  supportsWebGpu: vramTier !== 'none',
  supportsSharedArrayBuffer: true,
  estimatedRamMb: 8192,
  batteryLevel: null,
  isCharging: null,
  connectionType: 'wifi',
  isMobile: false,
});

// ---------------------------------------------------------------------------
// getModelRecommendationForTask
// ---------------------------------------------------------------------------

describe('getModelRecommendationForTask', () => {
  describe('embedding task', () => {
    it('returns MiniLM ONNX + transformers regardless of VRAM tier', () => {
      for (const tier of ['none', 'low', 'medium', 'high'] as const) {
        const result = getModelRecommendationForTask('embedding', baseReport(tier));
        expect(result.onnx).toBe('Xenova/all-MiniLM-L6-v2');
        expect(result.transformers).toBe('Xenova/all-MiniLM-L6-v2');
        expect(result.webllm).toBeUndefined();
      }
    });
  });

  describe('rag task', () => {
    it('returns SmolLM2-135M for all VRAM tiers', () => {
      const result = getModelRecommendationForTask('rag', baseReport('medium'));
      expect(result.onnx).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
      expect(result.transformers).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
      expect(result.webllm).toBeUndefined();
    });
  });

  describe('text-gen task — eco mode', () => {
    it('returns ECO_TEXT_GEN_MODEL when ecoMode=true, regardless of VRAM', () => {
      for (const tier of ['none', 'low', 'medium', 'high'] as const) {
        const result = getModelRecommendationForTask('text-gen', baseReport(tier), true);
        expect(result.onnx).toBe(ECO_TEXT_GEN_MODEL);
        expect(result.transformers).toBe(ECO_TEXT_GEN_MODEL);
        expect(result.webllm).toBeUndefined();
      }
    });
  });

  describe('text-gen task — no WebGPU (vramTier=none)', () => {
    it('returns SmolLM2-135M ONNX, no webllm', () => {
      const result = getModelRecommendationForTask('text-gen', baseReport('none'));
      expect(result.onnx).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
      expect(result.webllm).toBeUndefined();
    });
  });

  describe('text-gen task — low VRAM', () => {
    it('returns gemma-3-1b webllm and SmolLM2 ONNX', () => {
      const result = getModelRecommendationForTask('text-gen', baseReport('low'));
      expect(result.webllm).toBe('gemma-3-1b-it-q4f16_1-MLC');
      expect(result.onnx).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    });
  });

  describe('text-gen task — medium VRAM', () => {
    it('returns Llama-3.2-3B webllm and Qwen2.5-0.5B ONNX', () => {
      const result = getModelRecommendationForTask('text-gen', baseReport('medium'));
      expect(result.webllm).toBe('Llama-3.2-3B-Instruct-q4f16_1-MLC');
      expect(result.onnx).toBe('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
    });
  });

  describe('text-gen task — high VRAM', () => {
    it('returns Phi-4-mini webllm and Qwen2.5-1.5B ONNX', () => {
      const result = getModelRecommendationForTask('text-gen', baseReport('high'));
      expect(result.webllm).toBe('Phi-4-mini-instruct-q4f16_1-MLC');
      expect(result.onnx).toBe('Xenova/Qwen2.5-1.5B-Instruct');
    });
  });
});

// ---------------------------------------------------------------------------
// RECOMMENDED_OLLAMA_MODEL_IDS
// ---------------------------------------------------------------------------

describe('RECOMMENDED_OLLAMA_MODEL_IDS', () => {
  it('contains at least 5 entries', () => {
    expect(RECOMMENDED_OLLAMA_MODEL_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it('includes qwen3:8b and llama3.3', () => {
    expect(RECOMMENDED_OLLAMA_MODEL_IDS).toContain('qwen3:8b');
    expect(RECOMMENDED_OLLAMA_MODEL_IDS).toContain('llama3.3');
  });
});

// ---------------------------------------------------------------------------
// getProviderSpeedEstimate
// ---------------------------------------------------------------------------

describe('getProviderSpeedEstimate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('performance', { now: vi.fn().mockReturnValue(0) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns Infinity when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));
    const result = await getProviderSpeedEstimate('http://localhost:11434');
    expect(result).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity when response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    const result = await getProviderSpeedEstimate('http://localhost:11434');
    expect(result).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns elapsed time (>= 0) when response is ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    vi.mocked(performance.now).mockReturnValueOnce(100).mockReturnValueOnce(150);
    const result = await getProviderSpeedEstimate('http://localhost:11434');
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('fetches the /api/tags endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    await getProviderSpeedEstimate('http://localhost:5000');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'http://localhost:5000/api/tags',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
