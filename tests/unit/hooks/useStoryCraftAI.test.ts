import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStoryCraftAI } from '../../../hooks/useStoryCraftAI';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockComplete = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockSetCompletion = vi.fn();
let mockCompletionText = '';
let mockIsLoading = false;
let mockError: Error | undefined;

vi.mock('@ai-sdk/react', () => ({
  useCompletion: vi.fn(() => ({
    completion: mockCompletionText,
    complete: (...args: unknown[]) => mockComplete(...args),
    stop: mockStop,
    isLoading: mockIsLoading,
    error: mockError,
    setCompletion: mockSetCompletion,
  })),
}));

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        aiCreativity: 'Balanced',
        advancedAi: {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          ollamaBaseUrl: '',
          maxTokens: 2048,
          openAiCompatibleBaseUrl: '',
          openAiSiteUrl: '',
          openAiSiteTitle: '',
        },
      },
      // QNBS-v3: lora slice required — useStoryCraftAI accesses selectActiveLoraOllamaTag
      lora: { adapters: [], activeAdapterId: null },
      // QNBS-v3: all 20 flags required (strict TS) — useStoryCraftAI accesses enableLoraAdapters
      featureFlags: {
        enableStoryBibleAdvanced: false,
        enableBinderResearch: false,
        enableCompileWizard: false,
        enableProjectHealthScore: false,
        enableAppHealthPanel: false,
        enableDuckDbAnalytics: false,
        enableObjectsGroups: false,
        enableMindMaps: false,
        enableCharacterInterviews: false,
        enableRtlLayout: false,
        enableLoraAdapters: false,
        enablePluginSystem: false,
        enableVoiceSupport: false,
        enableVoiceWasm: false,
        enableProForge: false,
        enableIdbAtRestEncryption: false,
      },
    }),
  ),
}));

vi.mock('../../../services/ai/storyCraftCompletionFetch', () => ({
  STORYCRAFT_COMPLETION_URL: 'storycraft-internal://completion',
  storyCraftCompletionFetch: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockCompletionText = '';
  mockIsLoading = false;
  mockError = undefined;
  mockComplete.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Hook returns
// ---------------------------------------------------------------------------
describe('useStoryCraftAI — return shape', () => {
  it('exposes completion, runCompletion, stop, isLoading, error, setCompletion', () => {
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    expect(typeof result.current.completion).toBe('string');
    expect(typeof result.current.runCompletion).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.isLoading).toBe('boolean');
    expect(typeof result.current.setCompletion).toBe('function');
  });

  it('returns the current completion text', () => {
    mockCompletionText = 'Hello AI';
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    expect(result.current.completion).toBe('Hello AI');
  });

  it('returns the current isLoading flag', () => {
    mockIsLoading = true;
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    expect(result.current.isLoading).toBe(true);
  });

  it('returns the current error', () => {
    mockError = new Error('AI service error');
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    expect(result.current.error?.message).toBe('AI service error');
  });
});

// ---------------------------------------------------------------------------
// runCompletion
// ---------------------------------------------------------------------------
describe('runCompletion', () => {
  it('calls complete with the user prompt', async () => {
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    await act(async () => {
      await result.current.runCompletion('Write a story.');
    });
    expect(mockComplete).toHaveBeenCalledWith('Write a story.');
  });

  it('calls setCompletion to reset before running', async () => {
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    await act(async () => {
      await result.current.runCompletion('Prompt');
    });
    expect(mockSetCompletion).toHaveBeenCalledWith('');
  });
});

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------
describe('stop', () => {
  it('delegates stop to the underlying useCompletion stop', () => {
    const { result } = renderHook(() => useStoryCraftAI({ onIncremental: vi.fn() }));
    result.current.stop();
    expect(mockStop).toHaveBeenCalled();
  });
});
