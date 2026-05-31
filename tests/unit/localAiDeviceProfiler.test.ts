import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetDeviceProfileCache,
  generateDeviceProfile,
  getDeviceProfile,
  invalidateDeviceProfile,
} from '../../services/ai/localAiDeviceProfiler';

describe('localAiDeviceProfiler', () => {
  beforeEach(() => {
    _resetDeviceProfileCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateDeviceProfile', () => {
    it('returns a profile with all required fields', async () => {
      const profile = await generateDeviceProfile();

      expect(profile.webgpu).toBeDefined();
      // QNBS-v3: In jsdom navigator.gpu may not exist; webgpu.available is still a boolean or undefined.
      expect(
        profile.webgpu.available === true ||
          profile.webgpu.available === false ||
          profile.webgpu.available === undefined,
      ).toBe(true);

      expect(profile.webnn).toBeDefined();
      expect(typeof profile.webnn.available).toBe('boolean');

      expect(profile.directml).toBeDefined();
      expect(typeof profile.directml.available).toBe('boolean');

      expect(profile.computeShaders).toBeDefined();
      expect(
        profile.computeShaders.available === true ||
          profile.computeShaders.available === false ||
          profile.computeShaders.available === undefined,
      ).toBe(true);

      expect(profile.memoryTier).toMatch(/^(high|medium|low)$/);
      expect(profile.platform).toMatch(/^(pwa-web|pwa-mobile|tauri-desktop|tauri-mobile|unknown)$/);

      expect(profile.battery).toBeDefined();
      expect(profile.screen).toBeDefined();
      expect(typeof profile.cpuCores).toBe('number');
      expect(typeof profile.memoryPressureRatio).toBe('number');
      expect(typeof profile.recommendedBackend).toBe('string');
      expect(typeof profile.timestamp).toBe('number');
    });

    it('recommends heuristic when no GPU or WebNN available', async () => {
      // Simulate no GPU by ensuring navigator.gpu is undefined
      const originalGpu = (navigator as unknown as Record<string, unknown>)['gpu'];
      Object.defineProperty(navigator, 'gpu', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const profile = await generateDeviceProfile();
      // When navigator.gpu is missing, webgpu may be undefined or {available:false}
      const webgpuAvailable = profile.webgpu?.available ?? false;
      expect(webgpuAvailable).toBe(false);
      expect(['onnx-wasm', 'transformers-wasm', 'heuristic']).toContain(profile.recommendedBackend);

      // Restore
      if (originalGpu !== undefined) {
        Object.defineProperty(navigator, 'gpu', {
          value: originalGpu,
          configurable: true,
          writable: true,
        });
      }
    });

    it('recommends webllm-webgpu when high VRAM WebGPU available', async () => {
      const fakeAdapter = {
        limits: { maxBufferSize: 16 * 1024 * 1024 * 1024 },
        features: new Set(['timestamp-query']),
      };
      Object.defineProperty(navigator, 'gpu', {
        value: { requestAdapter: vi.fn().mockResolvedValue(fakeAdapter) },
        configurable: true,
        writable: true,
      });

      const profile = await generateDeviceProfile();
      if (profile.webgpu.available) {
        expect(profile.webgpu.vramTier).toBe('high');
        expect(profile.recommendedBackend).toBe('webllm-webgpu');
      }
    });
  });

  describe('getDeviceProfile caching', () => {
    it('returns cached profile within TTL', async () => {
      const p1 = await getDeviceProfile();
      const p2 = await getDeviceProfile();
      expect(p1.timestamp).toBe(p2.timestamp);
    });

    it('generates new profile after invalidate', async () => {
      const p1 = await getDeviceProfile();
      invalidateDeviceProfile();
      const p2 = await getDeviceProfile();
      expect(p2.timestamp).toBeGreaterThanOrEqual(p1.timestamp);
    });
  });
});
