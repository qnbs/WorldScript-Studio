import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCriticView } from '../../hooks/useCriticView';

const mockGenerateText = vi.fn<
  (...args: [string, string, Record<string, unknown>, AbortSignal?]) => Promise<string>
>(async () => 'AI critique result');
const mockGetPrompts = vi.fn<(...args: [string, unknown]) => { prompt: string }>(() => ({
  prompt: 'mock-prompt',
}));

const mockState = {
  settings: {
    advancedAi: {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      temperature: 0.7,
      maxTokens: 4096,
      ollamaBaseUrl: 'http://localhost:11434',
    },
  },
  aiCreativity: 'Balanced',
  projectData: {
    title: 'Test Story',
    logline: 'A hero saves the world',
    manuscript: [{ id: 's1', title: 'Chapter 1', content: 'A test chapter.' }],
    relationships: [],
  },
  characters: [{ id: 'c1', name: 'Hero' }],
  worlds: [{ id: 'w1', name: 'Terra' }],
};

vi.mock('../../app/hooks', () => ({
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'de' }),
}));
vi.mock('../../services/geminiService', () => ({
  getPrompts: (...args: Parameters<typeof mockGetPrompts>) => mockGetPrompts(...args),
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

describe('useCriticView', () => {
  beforeEach(() => {
    mockGenerateText.mockClear();
    mockGetPrompts.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a critic analysis when analyzeText is called', async () => {
    const { result } = renderHook(() => useCriticView());

    await act(async () => {
      await result.current.analyzeText('Test content');
    });

    expect(mockGetPrompts).toHaveBeenCalledWith('criticAnalysis', {
      text: 'Test content',
      lang: 'de',
    });
    expect(mockGenerateText).toHaveBeenCalledWith(
      'mock-prompt',
      mockState.aiCreativity,
      expect.objectContaining({ provider: 'gemini', model: 'gemini-1.5-flash' }),
      expect.any(AbortSignal),
    );
    expect(result.current.analysisResult).toBe('AI critique result');
    expect(result.current.isAnalyzing).toBe(false);
  });

  it('generates a plot hole detection report', async () => {
    const { result } = renderHook(() => useCriticView());

    await act(async () => {
      await result.current.detectPlotHoles();
    });

    expect(mockGetPrompts).toHaveBeenCalledWith('plotHoleDetection', {
      text: expect.stringContaining('Test Story'),
      lang: 'de',
    });
    expect(mockGenerateText).toHaveBeenCalled();
    expect(result.current.analysisResult).toBe('AI critique result');
  });

  it('handles errors gracefully', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('Service unavailable'));
    const { result } = renderHook(() => useCriticView());

    await act(async () => {
      await result.current.analyzeText('Test content');
    });

    await waitFor(() => expect(result.current.analysisResult).toContain('Error:'));
    expect(result.current.isAnalyzing).toBe(false);
  });
});
