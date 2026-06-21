/**
 * Tests for services/ai/modelRecommendations.ts
 * QNBS-v3: Covers task-based model selection and the Ollama speed probe.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceHealthReport } from '../../../services/ai/deviceHealthService';
import {
  ECO_TEXT_GEN_MODEL,
  getModelRecommendationForTask,
  getOllamaModelForDevice,
  getProviderSpeedEstimate,
  RECOMMENDED_OLLAMA_MODEL_IDS,
} from '../../../services/ai/modelRecommendations';

const baseReport: DeviceHealthReport = {
  deviceClass: 'mid-range',
  cpuCores: 4,
  heapUsedMb: 100,
  heapTotalMb: 1024,
  memoryPressureRatio: 0.1,
  storageQuotaMb: 4096,
  batteryLevel: 1,
  gpuVramTier: 'none',
  isMobile: false,
};

describe('getModelRecommendationForTask', () => {
  it('returns embedding models for embedding task', () => {
    const result = getModelRecommendationForTask('embedding', baseReport);
    expect(result.onnx).toBe('Xenova/all-MiniLM-L6-v2');
    expect(result.transformers).toBe('Xenova/all-MiniLM-L6-v2');
    expect(result.webllm).toBeUndefined();
  });

  it('returns tiny models for rag task', () => {
    const result = getModelRecommendationForTask('rag', baseReport);
    expect(result.onnx).toBe(ECO_TEXT_GEN_MODEL);
    expect(result.transformers).toBe(ECO_TEXT_GEN_MODEL);
  });

  it('eco mode overrides to smallest model regardless of VRAM', () => {
    const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'high' };
    const result = getModelRecommendationForTask('text-gen', report, true);
    expect(result.onnx).toBe(ECO_TEXT_GEN_MODEL);
    expect(result.transformers).toBe(ECO_TEXT_GEN_MODEL);
    expect(result.webllm).toBeUndefined();
  });

  it('no VRAM tier returns tiny CPU models', () => {
    const result = getModelRecommendationForTask('text-gen', baseReport);
    expect(result.onnx).toBe(ECO_TEXT_GEN_MODEL);
    expect(result.transformers).toBe(ECO_TEXT_GEN_MODEL);
    expect(result.webllm).toBeUndefined();
  });

  it('high VRAM tier returns larger WebLLM and ONNX models', () => {
    const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'high' };
    const result = getModelRecommendationForTask('text-gen', report);
    expect(result.webllm).toContain('Phi-4');
    expect(result.onnx).toContain('Qwen2.5');
  });

  it('medium VRAM tier returns mid-sized models', () => {
    const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'medium' };
    const result = getModelRecommendationForTask('text-gen', report);
    expect(result.webllm).toContain('Llama-3.2-3B');
    expect(result.onnx).toContain('Qwen2.5-0.5B');
  });

  it('low VRAM tier returns small models', () => {
    const report: DeviceHealthReport = { ...baseReport, gpuVramTier: 'low' };
    const result = getModelRecommendationForTask('text-gen', report);
    expect(result.webllm).toContain('gemma-3-1b');
    expect(result.onnx).toBe(ECO_TEXT_GEN_MODEL);
  });
});

describe('RECOMMENDED_OLLAMA_MODEL_IDS', () => {
  it('contains expected local model IDs', () => {
    expect(RECOMMENDED_OLLAMA_MODEL_IDS as readonly string[]).toContain('qwen3:8b');
    expect(RECOMMENDED_OLLAMA_MODEL_IDS as readonly string[]).toContain('llama3.3');
  });
});

describe('getProviderSpeedEstimate', () => {
  // QNBS-v3: Guaranteed teardown — restore globals + spies even if an assertion throws early,
  // so a failed test can never leave the fetch stub or performance.now spy active for later tests.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns round-trip latency on successful probe', async () => {
    // QNBS-v3: Fake the clock so latency is a deterministic value, not real wall-clock time.
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const latency = await getProviderSpeedEstimate('http://localhost:11434');
    expect(latency).toBe(100);
  });

  it('returns Infinity on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const latency = await getProviderSpeedEstimate('http://localhost:11434');
    expect(latency).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const latency = await getProviderSpeedEstimate('http://localhost:11434');
    expect(latency).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('getOllamaModelForDevice', () => {
  it('recommends the 7B model for a high-end device', () => {
    const rec = getOllamaModelForDevice({ ...baseReport, deviceClass: 'high-end' });
    expect(rec).toMatchObject({
      modelId: 'qwen2.5:7b',
      tier: 'high-end',
      downgradedForBattery: false,
    });
  });

  it('recommends the 3B model for a mid-range device', () => {
    const rec = getOllamaModelForDevice({ ...baseReport, deviceClass: 'mid-range' });
    expect(rec.modelId).toBe('llama3.2:3b');
    expect(rec.tier).toBe('mid-range');
  });

  it('recommends the smallest model for low-end and unknown devices', () => {
    expect(getOllamaModelForDevice({ ...baseReport, deviceClass: 'low-end' }).modelId).toBe(
      'llama3.2:1b',
    );
    expect(getOllamaModelForDevice({ ...baseReport, deviceClass: 'unknown' }).modelId).toBe(
      'llama3.2:1b',
    );
  });

  it('exposes a human-readable size hint', () => {
    expect(getOllamaModelForDevice({ ...baseReport, deviceClass: 'high-end' }).sizeHint).toMatch(
      /GB/,
    );
  });

  it('steps down one tier on low battery and flags the downgrade', () => {
    const rec = getOllamaModelForDevice({
      ...baseReport,
      deviceClass: 'high-end',
      batteryLevel: 0.1,
    });
    expect(rec.tier).toBe('mid-range');
    expect(rec.modelId).toBe('llama3.2:3b');
    expect(rec.downgradedForBattery).toBe(true);
  });

  it('does not downgrade below low-end and does not flag when battery is unknown', () => {
    const lowEndLowBattery = getOllamaModelForDevice({
      ...baseReport,
      deviceClass: 'low-end',
      batteryLevel: 0.05,
    });
    expect(lowEndLowBattery.tier).toBe('low-end');
    expect(lowEndLowBattery.downgradedForBattery).toBe(false);

    const noBattery = getOllamaModelForDevice({
      ...baseReport,
      deviceClass: 'high-end',
      batteryLevel: null,
    });
    expect(noBattery.tier).toBe('high-end');
    expect(noBattery.downgradedForBattery).toBe(false);
  });
});
