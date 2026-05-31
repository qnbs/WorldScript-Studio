import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../services/ai/ecoModeService', () => {
  const listeners = new Set<(isEco: boolean) => void>();
  let eco = false;
  return {
    ecoModeService: {
      isEcoMode: () => eco,
      onEcoModeChange: (fn: (isEco: boolean) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      _setEcoForTest: (v: boolean) => {
        eco = v;
        listeners.forEach((l) => {
          l(v);
        });
      },
    },
  };
});

const mockGenerateDeviceProfile = vi.fn();
vi.mock('../../../services/ai/localAiDeviceProfiler', () => ({
  generateDeviceProfile: (...args: unknown[]) => mockGenerateDeviceProfile(...args),
  invalidateDeviceProfile: vi.fn(),
}));

const mockGetTaskConfig = vi.fn();
const mockPrewarmModel = vi.fn();
const mockReleaseModel = vi.fn();
const mockGetWarmedModels = vi.fn().mockReturnValue([]);

vi.mock('../../../services/ai/adaptiveAiEngine', () => ({
  adaptiveAiEngine: {
    getTaskConfig: (...args: unknown[]) => mockGetTaskConfig(...args),
    prewarmModel: (...args: unknown[]) => mockPrewarmModel(...args),
    releaseModel: (...args: unknown[]) => mockReleaseModel(...args),
    getWarmedModels: () => mockGetWarmedModels(),
  },
}));

vi.mock('@domain/ai-core', () => ({
  releaseAllWebLlmEngines: vi.fn(),
  releaseAllOnnxSessions: vi.fn(),
}));

// Mock Redux store — flag states controlled per test
const mockSelectEnableAdaptiveAiEngine = vi.fn().mockReturnValue(false);
const mockSelectEnableComputeShaders = vi.fn().mockReturnValue(false);

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableAdaptiveAiEngine: (state: unknown) => mockSelectEnableAdaptiveAiEngine(state),
  selectEnableComputeShaders: (state: unknown) => mockSelectEnableComputeShaders(state),
}));

vi.mock('../../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) => selector({}),
}));

import { useAdaptiveAi } from '../../../hooks/useAdaptiveAi';
import { ecoModeService } from '../../../services/ai/ecoModeService';

// biome-ignore lint/suspicious/noExplicitAny: test helper
const ecoSvc = ecoModeService as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAdaptiveAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWarmedModels.mockReturnValue([]);
    mockGenerateDeviceProfile.mockResolvedValue({ recommendedBackend: 'onnx-wasm' });
  });

  it('returns enabled=false when feature flag is off', () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(false);
    const { result } = renderHook(() => useAdaptiveAi());
    expect(result.current.enabled).toBe(false);
  });

  it('returns enabled=true when feature flag is on', () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(true);
    const { result } = renderHook(() => useAdaptiveAi());
    expect(result.current.enabled).toBe(true);
  });

  it('does not fetch device profile when disabled', () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(false);
    renderHook(() => useAdaptiveAi());
    expect(mockGenerateDeviceProfile).not.toHaveBeenCalled();
  });

  it('fetches device profile when enabled', async () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(true);
    const { result } = renderHook(() => useAdaptiveAi());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGenerateDeviceProfile).toHaveBeenCalled();
    expect(result.current.deviceProfile).toEqual({ recommendedBackend: 'onnx-wasm' });
  });

  it('updates isEco when eco-mode changes', async () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(false);
    const { result } = renderHook(() => useAdaptiveAi());
    expect(result.current.isEco).toBe(false);

    await act(async () => {
      ecoSvc._setEcoForTest(true);
    });
    expect(result.current.isEco).toBe(true);

    await act(async () => {
      ecoSvc._setEcoForTest(false);
    });
    expect(result.current.isEco).toBe(false);
  });

  it('delegates getTaskConfig to adaptiveAiEngine', async () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(true);
    mockGetTaskConfig.mockResolvedValue({
      backend: 'onnx-wasm',
      modelId: 'test',
      estimatedLatencyMs: 200,
    });
    const { result } = renderHook(() => useAdaptiveAi());
    const config = await result.current.getTaskConfig('embedding');
    expect(mockGetTaskConfig).toHaveBeenCalledWith('embedding');
    expect(config.backend).toBe('onnx-wasm');
  });

  it('prewarmModel updates warmedModels list', async () => {
    mockSelectEnableAdaptiveAiEngine.mockReturnValue(true);
    mockPrewarmModel.mockResolvedValue(undefined);
    const warmedEntry = {
      task: 'embedding',
      backend: 'onnx-wasm',
      modelId: 'test',
      warmedAt: 0,
      lastUsedAt: 0,
    };
    mockGetWarmedModels.mockReturnValue([warmedEntry]);

    const { result } = renderHook(() => useAdaptiveAi());
    await act(async () => {
      await result.current.prewarmModel('embedding');
    });
    expect(mockPrewarmModel).toHaveBeenCalledWith('embedding');
    expect(result.current.warmedModels).toEqual([warmedEntry]);
  });
});
