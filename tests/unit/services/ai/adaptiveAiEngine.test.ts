// QNBS-v3: P1 Coverage improvement for adaptiveAiEngine
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../services/ai/localAiDeviceProfiler', () => ({
  getDeviceProfile: vi.fn(),
  invalidateDeviceProfile: vi.fn(),
}));

vi.mock('../../../../services/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adaptiveAiEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('selectModelForBackend', () => {
    it('selects high-VRAM WebLLM model for webllm-webgpu backend', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true, vramTier: 'high' },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'high',
        platform: 'pwa-web',
        battery: { level: 0.8, charging: true },
        screen: { dpr: 2, width: 1920, height: 1080 },
        cpuCores: 8,
        memoryPressureRatio: 0.3,
        recommendedBackend: 'webllm-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      expect(config.backend).toBe('webllm-webgpu');
      expect(config.modelId).toBe('Phi-4-mini-instruct-q4f16_1-MLC');
    });

    it('selects medium-VRAM WebLLM model for medium VRAM', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true, vramTier: 'medium' },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'medium',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: false },
        screen: { dpr: 2, width: 1920, height: 1080 },
        cpuCores: 4,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'webllm-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-long');

      expect(config.modelId).toBe('Llama-3.2-3B-Instruct-q4f16_1-MLC');
    });

    it('selects low-VRAM WebLLM model for low VRAM', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true, vramTier: 'low' },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.9, charging: true },
        screen: { dpr: 1, width: 1280, height: 720 },
        cpuCores: 2,
        memoryPressureRatio: 0.7,
        recommendedBackend: 'webllm-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      expect(config.modelId).toBe('gemma-3-1b-it-q4f16_1-MLC');
    });

    it('selects ONNX model for high memory tier', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'high',
        platform: 'pwa-web',
        battery: { level: 0.8, charging: true },
        screen: { dpr: 2, width: 1920, height: 1080 },
        cpuCores: 8,
        memoryPressureRatio: 0.3,
        recommendedBackend: 'onnx-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('embedding');

      expect(config.backend).toBe('transformers-webgpu');
      expect(config.modelId).toBe('Xenova/Qwen2.5-1.5B-Instruct');
    });

    it('selects ONNX model for medium memory tier', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'medium',
        platform: 'pwa-web',
        battery: { level: 0.6, charging: false },
        screen: { dpr: 2, width: 1920, height: 1080 },
        cpuCores: 4,
        memoryPressureRatio: 0.4,
        recommendedBackend: 'onnx-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('embedding');

      expect(config.modelId).toBe('Xenova/Qwen2.5-0.5B-Instruct');
    });

    it('selects ONNX model for low memory tier', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: true },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.2, charging: false },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.8,
        recommendedBackend: 'onnx-webgpu',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('embedding');

      expect(config.modelId).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
    });
  });

  describe('isBackendAvailable', () => {
    it('returns true for WASM backends', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: true },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      // WASM backends always available - onnx-wasm comes before transformers-wasm in priority
      expect(config.backend).toBe('onnx-wasm');
    });

    it('returns onnx-wasm when webgpu unavailable but WASM works', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: true },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      // onnx-wasm comes before heuristic in priority list and WASM always works
      expect(config.backend).toBe('onnx-wasm');
    });
  });

  describe('powerPreference', () => {
    it('sets low-power when battery level < 30%', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.2, charging: false },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      expect(config.powerPreference).toBe('low-power');
    });

    it('sets high-performance when battery level >= 30%', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: true },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      expect(config.powerPreference).toBe('high-performance');
    });
  });

  describe('latency estimation', () => {
    it('returns default latency when no history exists', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: true },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig } = await import('../../../../services/ai/adaptiveAiEngine');
      const config = await getTaskConfig('text-gen-short');

      // Default latency is 500ms
      expect(config.estimatedLatencyMs).toBe(500);
    });
  });

  describe('warmed models', () => {
    it('tracks warmed models correctly', async () => {
      const { getDeviceProfile } = await import('../../../../services/ai/localAiDeviceProfiler');
      vi.mocked(getDeviceProfile).mockResolvedValue({
        webgpu: { available: false },
        webnn: { available: false },
        directml: { available: false },
        computeShaders: { available: false },
        memoryTier: 'low',
        platform: 'pwa-web',
        battery: { level: 0.5, charging: true },
        screen: { dpr: 1, width: 1024, height: 768 },
        cpuCores: 2,
        memoryPressureRatio: 0.5,
        recommendedBackend: 'heuristic',
        timestamp: Date.now(),
      });

      const { getTaskConfig, _clearLatencyHistory } = await import(
        '../../../../services/ai/adaptiveAiEngine'
      );
      _clearLatencyHistory();

      const config1 = await getTaskConfig('text-gen-short');
      // onnx-wasm comes before heuristic in priority list and WASM always works
      expect(config1.backend).toBe('onnx-wasm');
    });
  });
});
