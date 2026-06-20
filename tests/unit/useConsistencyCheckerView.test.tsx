import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsistencyCheckerView } from '../../hooks/useConsistencyCheckerView';
import type { StoryCodex } from '../../types';

type MockProjectData = {
  id: string;
  manuscript: { id: string; content: string }[];
  relationships: unknown[];
};

type MockState = {
  aiCreativity: string;
  settings: {
    advancedAi: {
      provider: string;
      model: string;
      temperature: number;
      maxTokens: number;
      ollamaBaseUrl: string;
      localBackendPreset: string;
      openAiCompatibleBaseUrl: string;
      openAiSiteUrl: string;
      openAiSiteTitle: string;
      hybridFallbackEnabled: boolean;
      hybridFallbackChain: string[];
      ragMode: 'lexical' | 'hybrid';
    };
  };
  featureFlags: { enableDuckDbAnalytics: boolean };
  projectData: MockProjectData | undefined;
  characters: { id: string; name: string }[];
  worlds: { id: string; name: string }[];
};

const mockDispatch = vi.fn();
const mockGenerateText = vi.fn<
  (...args: [string, string, Record<string, unknown>, AbortSignal?]) => Promise<string>
>(async () => 'Consistency OK');
const mockGetStoryCodex = vi.fn<(...args: [string]) => Promise<StoryCodex | null>>(
  async () => null,
);
const mockGetPrompts = vi.fn<(...args: [string, unknown]) => { prompt: string }>(() => ({
  prompt: 'check prompt',
}));
const mockState: MockState = {
  aiCreativity: 'Balanced',
  settings: {
    advancedAi: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      temperature: 0.7,
      maxTokens: 4096,
      ollamaBaseUrl: 'http://localhost:11434',
      localBackendPreset: 'ollama_default',
      openAiCompatibleBaseUrl: '',
      openAiSiteUrl: '',
      openAiSiteTitle: 'WorldScript Studio',
      hybridFallbackEnabled: false,
      hybridFallbackChain: [],
      ragMode: 'hybrid' as const,
    },
  },
  featureFlags: { enableDuckDbAnalytics: false },
  projectData: {
    id: 'proj-1',
    manuscript: [{ id: 's1', content: 'A quick test story.' }],
    relationships: [],
  },
  characters: [{ id: 'c1', name: 'Hero' }],
  worlds: [{ id: 'w1', name: 'Terra' }],
};

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'de' }),
}));
vi.mock('../../services/geminiService', () => ({
  getPrompts: (...args: Parameters<typeof mockGetPrompts>) => mockGetPrompts(...args),
}));
vi.mock('../../services/dbService', () => ({
  dbService: {
    getStoryCodex: (...args: Parameters<typeof mockGetStoryCodex>) => mockGetStoryCodex(...args),
  },
}));
vi.mock('../../services/codexService', () => ({
  // QNBS-v3: hook now calls loadStoryCodex from codexService, not dbService directly.
  loadStoryCodex: (...args: Parameters<typeof mockGetStoryCodex>) => mockGetStoryCodex(...args),
  extractStoryCodex: vi.fn().mockReturnValue({ entries: [] }),
  saveStoryCodex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/localRagService', () => ({
  retrieveContext: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384)),
}));
vi.mock('../../services/aiProviderService', () => ({
  generateText: (...args: Parameters<typeof mockGenerateText>) => mockGenerateText(...args),
}));
vi.mock('../../features/project/projectSelectors', () => ({
  selectAiCreativity: (state: typeof mockState) => state.aiCreativity,
  selectAllCharacters: (state: typeof mockState) => state.characters,
  selectAllWorlds: (state: typeof mockState) => state.worlds,
  selectProjectData: (state: typeof mockState) => state.projectData,
}));

describe('useConsistencyCheckerView', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockGenerateText.mockReset().mockImplementation(async () => 'Consistency OK');
    mockGetStoryCodex.mockReset().mockResolvedValue(null);
    mockGetPrompts.mockClear();
  });

  it('runs consistency checks and updates result state', async () => {
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      'check prompt',
      mockState.aiCreativity,
      expect.objectContaining({ provider: expect.any(String), model: expect.any(String) }),
      expect.any(Object),
    );

    await waitFor(() =>
      expect(result.current.checkResult).toEqual({ kind: 'text', text: 'Consistency OK' }),
    );
    expect(result.current.isChecking).toBe(false);
  });

  it('returns early when no project data is available', async () => {
    const originalProjectData = mockState.projectData;
    mockState.projectData = undefined;

    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).not.toHaveBeenCalled();
    mockState.projectData = originalProjectData;
  });

  it('preserves an existing check result when a later request is aborted', async () => {
    const { result } = renderHook(() => useConsistencyCheckerView());

    // Seed a non-null result via a successful run.
    mockGenerateText.mockReset().mockImplementation(async () => 'Consistency OK');
    await act(async () => {
      await result.current.runCheck('c1');
    });
    await waitFor(() =>
      expect(result.current.checkResult).toEqual({ kind: 'text', text: 'Consistency OK' }),
    );

    // A subsequent aborted run must NOT clear the prior result.
    mockGenerateText.mockReset().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(result.current.checkResult).toEqual({ kind: 'text', text: 'Consistency OK' });
    expect(result.current.isChecking).toBe(false);
  });

  it('sets a friendly error message when the check fails for non-abort reasons', async () => {
    mockGenerateText.mockRejectedValue(new Error('Service unavailable'));
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    await waitFor(() => {
      const r = result.current.checkResult;
      expect(r?.kind).toBe('text');
      expect(r?.kind === 'text' ? r.text : '').toContain('Error:');
    });
    expect(result.current.isChecking).toBe(false);
  });

  it('parses a JSON finding array into structured results', async () => {
    mockGenerateText.mockReset().mockImplementation(async () =>
      JSON.stringify([
        {
          severity: 'error',
          title: 'Eye colour',
          detail: 'Blue in Ch1, brown in Ch3.',
          ref: 'Chapter 3',
        },
        { severity: 'info', title: 'Age', detail: 'Consistent throughout.' },
      ]),
    );
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    await waitFor(() => {
      const r = result.current.checkResult;
      expect(r?.kind).toBe('structured');
      if (r?.kind === 'structured') {
        expect(r.findings).toHaveLength(2);
        expect(r.findings[0]).toEqual({
          id: '0',
          severity: 'error',
          title: 'Eye colour',
          detail: 'Blue in Ch1, brown in Ch3.',
          ref: 'Chapter 3',
        });
      }
    });
  });

  it('normalizes severity variants (warning/ERROR/uppercase) instead of downgrading to info', async () => {
    mockGenerateText.mockReset().mockImplementation(async () =>
      JSON.stringify([
        { severity: 'warning', title: 'Pacing', detail: 'Slow middle.' },
        { severity: 'ERROR', title: 'Contradiction', detail: 'Dead character speaks.' },
        { severity: ' High ', title: 'Plot hole', detail: 'Unexplained jump.' },
      ]),
    );
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    await waitFor(() => {
      const r = result.current.checkResult;
      expect(r?.kind).toBe('structured');
      if (r?.kind === 'structured') {
        expect(r.findings.map((f) => f.severity)).toEqual(['warn', 'error', 'error']);
      }
    });
  });

  it('falls back to text when JSON output is fenced but malformed', async () => {
    mockGenerateText.mockReset().mockImplementation(async () => '```json\nnot-an-array\n```');
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    await waitFor(() => expect(result.current.checkResult?.kind).toBe('text'));
  });

  it('aborts active consistency checks when the component unmounts', async () => {
    let abortSignal: AbortSignal | null = null;
    mockGenerateText.mockImplementation(
      async (
        _prompt: string,
        _creativity: string,
        _opts: Record<string, unknown>,
        signal?: AbortSignal,
      ) => {
        abortSignal = signal ?? null;
        return new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      },
    );

    const { result, unmount } = renderHook(() => useConsistencyCheckerView());
    act(() => {
      result.current.runCheck('c1');
    });
    // QNBS-v3: flush microtasks from mocked embedText/retrieveContext so runCheck reaches generateText.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    unmount();
    expect(abortSignal).not.toBeNull();
    if (abortSignal) {
      expect((abortSignal as AbortSignal).aborted).toBe(true);
    }
  });

  it('loads story codex and adds it to the prompt arguments', async () => {
    const storyCodex: StoryCodex = {
      projectId: 'proj-1',
      extractedAt: new Date().toISOString(),
      summary: 'Keep the hero grounded.',
      entities: [],
    };
    mockGetStoryCodex.mockResolvedValue(storyCodex);

    const { result } = renderHook(() => useConsistencyCheckerView());

    await waitFor(() => expect(mockGetStoryCodex).toHaveBeenCalledWith('proj-1'));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).toHaveBeenCalled();
    expect(mockGetPrompts).toHaveBeenCalledWith(
      'consistencyCheck',
      expect.objectContaining({
        characterId: 'c1',
        codex: storyCodex,
      }),
    );
  });

  it('handles story codex load failure and resets storyCodex to null', async () => {
    mockGetStoryCodex.mockRejectedValue(new Error('DB unavailable'));
    const { result } = renderHook(() => useConsistencyCheckerView());

    await waitFor(() => expect(mockGetStoryCodex).toHaveBeenCalled());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.checkResult).toEqual({ kind: 'text', text: 'Consistency OK' }),
    );
  });

  it('sets storyCodex to null when no project data exists', async () => {
    const originalProjectData = mockState.projectData;
    mockState.projectData = undefined;

    const { result } = renderHook(() => useConsistencyCheckerView());

    await waitFor(() => expect(mockGetStoryCodex).not.toHaveBeenCalled());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).not.toHaveBeenCalled();
    mockState.projectData = originalProjectData;
  });
});
