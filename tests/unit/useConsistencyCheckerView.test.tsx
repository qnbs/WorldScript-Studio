import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConsistencyCheckerView } from '../../hooks/useConsistencyCheckerView';

const mockDispatch = vi.fn();
const mockGenerateText = vi.fn(async () => 'Consistency OK');
const mockGetStoryCodex = vi.fn(async () => null);
const mockGetPrompts = vi.fn(() => ({ prompt: 'check prompt' }));
const mockState = {
  aiCreativity: 'Balanced',
  settings: {
    advancedAi: {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
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
  getPrompts: (...args: unknown[]) => mockGetPrompts(...args),
}));
vi.mock('../../services/dbService', () => ({
  dbService: {
    getStoryCodex: (...args: unknown[]) => mockGetStoryCodex(...args),
  },
}));
vi.mock('../../services/aiProviderService', () => ({
  generateText: (...args: unknown[]) => (mockGenerateText as any)(...args),
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
      expect.any(Object)
    );

    await waitFor(() => expect(result.current.checkResult).toBe('Consistency OK'));
    expect(result.current.isChecking).toBe(false);
  });

  it('returns early when no project data is available', async () => {
    const originalProjectData = mockState.projectData;
    mockState.projectData = undefined as any;

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
    let abortSignal: any = null;
    mockGenerateText.mockImplementation(async (...args: unknown[]) => {
      const signal = args[3] as AbortSignal | undefined;
      abortSignal = signal ?? null;
      return new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    });

    const { result, unmount } = renderHook(() => useConsistencyCheckerView());
    act(() => {
      result.current.runCheck('c1');
    });

    unmount();
    expect(abortSignal?.aborted).toBe(true);
  });

  it('loads story codex and adds it to the prompt arguments', async () => {
    const storyCodex = { id: 'codex-1', notes: ['Keep the hero grounded.'] } as any;
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
      })
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
    mockState.projectData = undefined as any;

    const { result } = renderHook(() => useConsistencyCheckerView());

    await waitFor(() => expect(mockGetStoryCodex).not.toHaveBeenCalled());

    await act(async () => {
      await result.current.runCheck('c1');
    });

    expect(mockGenerateText).not.toHaveBeenCalled();
    mockState.projectData = originalProjectData;
  });
});
