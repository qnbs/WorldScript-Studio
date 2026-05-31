import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearLatencyHistory, AdaptiveAiEngine } from '../../services/ai/adaptiveAiEngine';
import type { DeviceCapabilityProfile } from '../../services/ai/localAiDeviceProfiler';

// Mock the profiler
vi.mock('../../services/ai/localAiDeviceProfiler', () => ({
  getDeviceProfile: vi.fn(),
  invalidateDeviceProfile: vi.fn(),
  _resetDeviceProfileCache: vi.fn(),
}));

import { getDeviceProfile } from '../../services/ai/localAiDeviceProfiler';

describe('AdaptiveAiEngine', () => {
  let engine: AdaptiveAiEngine;
  const mockGetDeviceProfile = vi.mocked(getDeviceProfile);

  beforeEach(() => {
    engine = new AdaptiveAiEngine();
    _clearLatencyHistory();
    vi.clearAllMocks();
  });

  function makeProfile(overrides: Partial<DeviceCapabilityProfile> = {}): DeviceCapabilityProfile {
    return {
      webgpu: { available: false },
      webnn: { available: false },
      directml: { available: false },
      computeShaders: { available: false },
      memoryTier: 'medium',
      platform: 'pwa-web',
      battery: { level: 0.5, charging: true },
      screen: { dpr: 1, width: 1920, height: 1080 },
      cpuCores: 4,
      memoryPressureRatio: 0.3,
      recommendedBackend: 'onnx-wasm',
      timestamp: Date.now(),
      ...overrides,
    } as DeviceCapabilityProfile;
  }

  describe('getTaskConfig', () => {
    it('selects webllm-webgpu for text-gen when high VRAM available', async () => {
      mockGetDeviceProfile.mockResolvedValue(
        makeProfile({
          webgpu: { available: true, vramTier: 'high' },
          recommendedBackend: 'webllm-webgpu',
        }),
      );

      const config = await engine.getTaskConfig('text-gen-long');
      expect(config.backend).toBe('webllm-webgpu');
      expect(config.modelId).toContain('MLC');
    });

    it('selects onnx-wasm for embedding on low-end device', async () => {
      mockGetDeviceProfile.mockResolvedValue(
        makeProfile({
          webgpu: { available: false },
          memoryTier: 'low',
          recommendedBackend: 'transformers-wasm',
        }),
      );

      const config = await engine.getTaskConfig('embedding');
      expect(config.backend).toBe('transformers-wasm');
    });

    it('sets low-power when battery < 30%', async () => {
      mockGetDeviceProfile.mockResolvedValue(
        makeProfile({
          battery: { level: 0.2, charging: false },
        }),
      );

      const config = await engine.getTaskConfig('text-gen-short');
      expect(config.powerPreference).toBe('low-power');
    });

    it('sets high-performance when battery >= 30%', async () => {
      mockGetDeviceProfile.mockResolvedValue(
        makeProfile({
          battery: { level: 0.5, charging: true },
        }),
      );

      const config = await engine.getTaskConfig('text-gen-short');
      expect(config.powerPreference).toBe('high-performance');
    });
  });

  describe('prewarm / release', () => {
    it('prewarms a model and reports warmed status', async () => {
      mockGetDeviceProfile.mockResolvedValue(makeProfile());

      expect(engine.isWarmed('text-gen-short')).toBe(false);
      await engine.prewarmModel('text-gen-short');
      expect(engine.isWarmed('text-gen-short')).toBe(true);
    });

    it('releases a warmed model', async () => {
      mockGetDeviceProfile.mockResolvedValue(makeProfile());

      await engine.prewarmModel('text-gen-short');
      engine.releaseModel('text-gen-short');
      expect(engine.isWarmed('text-gen-short')).toBe(false);
    });

    it('evicts oldest model when capacity exceeded', async () => {
      mockGetDeviceProfile.mockResolvedValue(makeProfile());

      await engine.prewarmModel('text-gen-short');
      await engine.prewarmModel('text-gen-long');
      await engine.prewarmModel('embedding');
      await engine.prewarmModel('vision'); // Should evict the oldest

      const warmed = engine.getWarmedModels();
      expect(warmed.length).toBe(3);
    });
  });

  describe('latency recording', () => {
    it('records and estimates latency', async () => {
      const profile = makeProfile(); // memoryTier: 'medium' → onnx model = Xenova/Qwen2.5-0.5B-Instruct
      mockGetDeviceProfile.mockResolvedValue(profile);

      // Use the exact key the engine will construct: task:backend:modelId
      const backend = 'onnx-wasm';
      const modelId = 'Xenova/Qwen2.5-0.5B-Instruct';
      engine.recordTaskLatency('text-gen-short', backend, modelId, 120);
      engine.recordTaskLatency('text-gen-short', backend, modelId, 180);

      const config = await engine.getTaskConfig('text-gen-short');
      // Moving average of [120, 180] = 150ms
      expect(config.estimatedLatencyMs).toBeCloseTo(150, 0);
    });

    it('returns default 500ms when no history exists', async () => {
      mockGetDeviceProfile.mockResolvedValue(makeProfile());
      const config = await engine.getTaskConfig('text-gen-long');
      expect(config.estimatedLatencyMs).toBe(500);
    });
  });

  describe('isBackendAvailable', () => {
    it('returns false for webllm-webgpu when no WebGPU', () => {
      const profile = makeProfile({ webgpu: { available: false } });
      expect(engine.isBackendAvailable('webllm-webgpu', profile)).toBe(false);
    });

    it('returns true for wasm backends always', () => {
      const profile = makeProfile({ webgpu: { available: false } });
      expect(engine.isBackendAvailable('onnx-wasm', profile)).toBe(true);
      expect(engine.isBackendAvailable('transformers-wasm', profile)).toBe(true);
    });
  });
});
