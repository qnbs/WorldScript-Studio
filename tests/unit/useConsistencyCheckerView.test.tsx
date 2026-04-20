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
    };
  };
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
    },
  },
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

    await waitFor(() => expect(result.current.checkResult).toBe('Consistency OK'));
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

  it('preserves check result when request is aborted', async () => {
    mockGenerateText.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(result.current.checkResult).toBe('');
    expect(result.current.isChecking).toBe(false);
  });

  it('sets a friendly error message when the check fails for non-abort reasons', async () => {
    mockGenerateText.mockRejectedValue(new Error('Service unavailable'));
    const { result } = renderHook(() => useConsistencyCheckerView());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    await waitFor(() => expect(result.current.checkResult).toContain('Error:'));
    expect(result.current.isChecking).toBe(false);
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
    await waitFor(() => expect(result.current.checkResult).toBe('Consistency OK'));
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
