import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type DispatcherAction = { type: string; payload?: unknown };

type StreamGenerationThunk = {
  type: 'streamGenerationThunk';
  payload: { prompt?: string; onChunk?: (chunk: string) => void };
};

const isDispatcherAction = (value: unknown): value is DispatcherAction =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string';

const isStreamGenerationThunk = (value: unknown): value is StreamGenerationThunk =>
  isDispatcherAction(value) && value.type === 'streamGenerationThunk';

const mockDispatch = vi.fn((action: unknown) => {
  if (isStreamGenerationThunk(action)) {
    return {
      unwrap: async () => {
        const payload = action.payload;
        if (payload?.onChunk) {
          payload.onChunk('stream-chunk');
        }
        return 'stream-complete';
      },
    };
  }
  return { unwrap: () => Promise.resolve('') };
});

const mockState: {
  projectData: {
    characters: { id: string; name: string }[];
    worlds: { id: string; name: string }[];
    manuscript: { id: string; content: string }[];
    relationships: unknown[];
    projectGoals: { totalWordCount: number; targetDate: string | null };
    writingHistory: unknown[];
  };
  writer: {
    activeTool: string;
    selection: { text: string; start: number; end: number };
    dialogueCharacters: { id: string; name: string }[];
    scenario: string;
    brainstormContext: string;
    tone: string;
    style: string;
    isLoading: boolean;
    generationHistory: string[];
    activeHistoryIndex: number;
    selectedSectionId: string | null;
  };
} = {
  projectData: {
    characters: [{ id: 'c1', name: 'Hero' }],
    worlds: [{ id: 'w1', name: 'Terra' }],
    manuscript: [{ id: 's1', content: 'Hello world' }],
    relationships: [],
    projectGoals: { totalWordCount: 1000, targetDate: null },
    writingHistory: [],
  },
  writer: {
    activeTool: 'continue',
    selection: { text: '', start: 0, end: 0 },
    dialogueCharacters: [],
    scenario: '',
    brainstormContext: '',
    tone: '',
    style: '',
    isLoading: false,
    generationHistory: ['Generated text'],
    activeHistoryIndex: 0,
    selectedSectionId: null,
  },
};

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
  useAppSelectorShallow: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('../../services/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('../../features/project/projectSelectors', () => ({
  selectProjectData: (state: typeof mockState) => state.projectData,
  selectAllCharacters: (state: typeof mockState) => state.projectData.characters,
  selectManuscript: (state: typeof mockState) => state.projectData.manuscript,
}));

const writerActions = {
  setSelectedSectionId: (id: string) => ({ type: 'setSelectedSectionId', payload: id }),
  stopLoading: () => ({ type: 'stopLoading' }),
  startLoading: () => ({ type: 'startLoading' }),
  clearResultStream: () => ({ type: 'clearResultStream' }),
  updateCurrentHistoryItem: (payload: unknown) => ({ type: 'updateCurrentHistoryItem', payload }),
  appendResultStream: (payload: unknown) => ({ type: 'appendResultStream', payload }),
  addHistory: (payload: unknown) => ({ type: 'addHistory', payload }),
  navigateHistory: (payload: unknown) => ({ type: 'navigateHistory', payload }),
};

vi.mock('../../features/writer/writerSlice', () => ({ writerActions }));
vi.mock('../../features/project/projectSlice', () => ({
  projectActions: {
    updateManuscriptSection: (payload: unknown) => ({ type: 'updateManuscriptSection', payload }),
  },
}));
vi.mock('../../features/project/thunks/writingThunks', () => ({
  streamGenerationThunk: (payload: unknown) => ({
    type: 'streamGenerationThunk',
    payload,
    unwrap: () => Promise.resolve(''),
  }),
}));

const createHookWrapper = async () => {
  const { useWriterView } = await import('../../hooks/useWriterView');
  const current: { current: ReturnType<typeof useWriterView> | null } = { current: null };

  function Test() {
    const value = useWriterView();
    useEffect(() => {
      current.current = value;
    }, [value]);
    return null;
  }

  render(<Test />);
  await waitFor(() => expect(current.current).not.toBeNull());
  return current.current!;
};

describe('useWriterView', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockState.writer.activeTool = 'continue';
    mockState.writer.selection = { text: '', start: 0, end: 0 };
    mockState.writer.dialogueCharacters = [];
    mockState.writer.scenario = '';
    mockState.writer.brainstormContext = '';
    mockState.writer.tone = '';
    mockState.writer.style = 'compelling';
    mockState.writer.isLoading = false;
    mockState.writer.selectedSectionId = 's1';
    mockState.writer.generationHistory = ['Generated text'];
    mockState.writer.activeHistoryIndex = 0;
  });

  it('returns a usable hook API and dispatches manuscript updates', async () => {
    const view = await createHookWrapper();

    expect(view.selectedSectionId).toBe('s1');
    await act(async () => {
      view.handleContentChange(0, 'New content');
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'updateManuscriptSection',
      payload: { id: 's1', changes: { content: 'New content' } },
    });
    expect(view.isGenerateDisabled()).toBe(false);
  });

  it('disables generation for improve tool without selection text', async () => {
    mockState.writer.activeTool = 'improve';
    mockState.writer.selection = { text: '', start: 0, end: 0 };

    const view = await createHookWrapper();
    expect(view.isGenerateDisabled()).toBe(true);
  });

  it('defaults selectedSectionId when none is set', async () => {
    mockState.writer.selectedSectionId = null;

    const view = await createHookWrapper();
    expect(view.selectedSectionId).toBe('s1');
  });

  it('disables dialogue generation when scenario or characters are missing', async () => {
    mockState.writer.activeTool = 'dialogue';
    mockState.writer.dialogueCharacters = [];
    mockState.writer.scenario = '';

    const view = await createHookWrapper();
    expect(view.isGenerateDisabled()).toBe(true);
  });

  it('replaces existing text on accept replace', async () => {
    mockState.writer.selection = { text: '', start: 6, end: 11 };
    mockState.writer.generationHistory = ['world'];
    mockState.writer.activeHistoryIndex = 0;

    const view = await createHookWrapper();
    await act(async () => {
      view.handleAccept('replace');
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'updateManuscriptSection',
      payload: { id: 's1', changes: { content: 'Hello world' } },
    });
  });

  it('inserts generated text on accept', async () => {
    mockState.writer.selection = { text: '', start: 6, end: 6 };
    mockState.writer.generationHistory = [' world'];
    mockState.writer.activeHistoryIndex = 0;

    const view = await createHookWrapper();
    await act(async () => {
      view.handleAccept('insert');
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'updateManuscriptSection',
      payload: { id: 's1', changes: { content: 'Hello  worldworld' } },
    });
  });

  it('dispatches generation actions when handleGenerate is called', async () => {
    mockState.writer.selection = { text: '', start: 0, end: 0 };
    mockState.writer.activeTool = 'continue';

    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    expect(
      mockDispatch.mock.calls.some(
        ([action]) => isDispatcherAction(action) && action.type === 'startLoading',
      ),
    ).toBe(true);
    expect(
      mockDispatch.mock.calls.some(
        ([action]) => isDispatcherAction(action) && action.type === 'clearResultStream',
      ),
    ).toBe(true);
    expect(
      mockDispatch.mock.calls.some(
        ([action]) => isDispatcherAction(action) && action.type === 'addHistory',
      ),
    ).toBe(true);
    expect(
      mockDispatch.mock.calls.some(
        ([action]) => isDispatcherAction(action) && action.type === 'streamGenerationThunk',
      ),
    ).toBe(true);
  });

  it('generates an improve prompt when improve tool is selected', async () => {
    mockState.writer.activeTool = 'improve';
    mockState.writer.selection = { text: 'short sample', start: 0, end: 12 };

    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    const thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
      isStreamGenerationThunk(call[0]),
    );
    expect(thunkCall).toBeDefined();
    expect(thunkCall?.[0].payload.prompt).toContain('Improve the following text');
    expect(thunkCall?.[0].payload.prompt).toContain('short sample');
  });

  it('generates a dialogue prompt when dialogue tool is selected', async () => {
    mockState.writer.activeTool = 'dialogue';
    mockState.writer.dialogueCharacters = [{ id: 'c2', name: 'Villain' }];
    mockState.writer.scenario = 'A tense encounter';

    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    const thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
      isStreamGenerationThunk(call[0]),
    );
    expect(thunkCall?.[0].payload.prompt).toContain('Write a piece of dialogue between Villain');
    expect(thunkCall?.[0].payload.prompt).toContain('A tense encounter');
  });

  it('builds prompts for multiple writer tools', async () => {
    const scenarios = [
      {
        tool: 'changeTone' as const,
        state: { selection: { text: 'example', start: 0, end: 7 }, tone: 'dramatic' },
        expected: 'Rewrite the following text in a dramatic tone',
      },
      {
        tool: 'brainstorm' as const,
        state: { brainstormContext: 'an empty castle' },
        expected: 'Brainstorm 3-5 interesting plot points',
      },
      {
        tool: 'synopsis' as const,
        state: { selection: { text: '', start: 0, end: 0 } },
        expected: 'Write a concise, one-paragraph synopsis',
      },
      {
        tool: 'grammarCheck' as const,
        state: { selection: { text: 'bad grammar', start: 0, end: 11 } },
        expected: 'Correct grammar, style, and repetitions',
      },
      {
        tool: 'critic' as const,
        state: { selection: { text: '', start: 0, end: 0 } },
        expected: 'Act as a professional literary critic and editor',
      },
      {
        tool: 'plotholes' as const,
        state: { selection: { text: '', start: 0, end: 0 } },
        expected: 'Act as a detail-oriented story editor',
      },
      {
        tool: 'consistency' as const,
        state: { selection: { text: '', start: 0, end: 0 } },
        expected: 'Check for contradictions against the established lore',
      },
      {
        tool: 'imagePrompt' as const,
        state: { selection: { text: 'a glowing sword', start: 0, end: 13 } },
        expected: 'You are an expert AI image prompt engineer',
      },
    ];

    for (const scenario of scenarios) {
      mockDispatch.mockClear();
      mockState.writer.activeTool = scenario.tool;
      mockState.writer.selection = scenario.state.selection ?? { text: '', start: 0, end: 0 };
      mockState.writer.tone = scenario.state.tone ?? '';
      mockState.writer.brainstormContext = scenario.state.brainstormContext ?? '';
      mockState.writer.dialogueCharacters = [];
      mockState.writer.scenario = '';

      const view = await createHookWrapper();
      await act(async () => {
        view.handleGenerate();
      });

      const thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
        isStreamGenerationThunk(call[0]),
      );
      expect(thunkCall).toBeDefined();
      expect(thunkCall?.[0].payload.prompt).toContain(scenario.expected);
    }
  });

  it('does not generate while loading', async () => {
    mockState.writer.isLoading = true;
    mockState.writer.activeTool = 'continue';

    const view = await createHookWrapper();
    act(() => view.handleGenerate());

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'streamGenerationThunk' }),
    );
  });

  it('uses default tone for changeTone when tone is empty', async () => {
    mockState.writer.activeTool = 'changeTone';
    mockState.writer.selection = { text: 'tone text', start: 0, end: 9 };
    mockState.writer.tone = '';

    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    const thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
      isStreamGenerationThunk(call[0]),
    );
    expect(thunkCall?.[0].payload.prompt).toContain(
      'Rewrite the following text in a different tone',
    );
  });

  it('disables generation when no section is selected', async () => {
    mockState.writer.activeTool = 'continue';
    mockState.writer.selection = { text: '', start: 0, end: 0 };
    mockState.writer.selectedSectionId = null;
    mockState.projectData.manuscript = [];

    const view = await createHookWrapper();
    expect(view.isGenerateDisabled()).toBe(true);
    mockState.projectData.manuscript = [{ id: 's1', content: 'Hello world' }];
  });

  it('disables dialogue generation when the scenario is missing', async () => {
    mockState.writer.activeTool = 'dialogue';
    mockState.writer.dialogueCharacters = [{ id: 'c2', name: 'Villain' }];
    mockState.writer.scenario = '';

    const view = await createHookWrapper();
    expect(view.isGenerateDisabled()).toBe(true);
  });

  it('handles generation errors and dispatches a friendly error message', async () => {
    mockDispatch.mockClear();
    const originalImplementation = mockDispatch.getMockImplementation();
    mockDispatch.mockImplementation((action) => {
      if (isStreamGenerationThunk(action)) {
        return {
          unwrap: async () => {
            const error = new Error('Unexpected failure');
            error.name = 'SomeError';
            throw error;
          },
        };
      }
      return originalImplementation?.(action) ?? { unwrap: () => Promise.resolve('') };
    });

    mockState.writer.activeTool = 'continue';
    mockState.writer.isLoading = false;
    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateCurrentHistoryItem',
          payload: 'Error generating content. Please try again later or check your API key.',
        }),
      ),
    );

    if (originalImplementation) {
      mockDispatch.mockImplementation(originalImplementation);
    }
  });

  it('falls back to content for brainstorm and image prompts when no selection exists', async () => {
    mockState.writer.activeTool = 'brainstorm';
    mockState.writer.selection = { text: '', start: 0, end: 0 };
    mockState.writer.brainstormContext = '';

    let view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });
    let thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
      isStreamGenerationThunk(call[0]),
    );
    expect(thunkCall?.[0].payload.prompt).toContain('based on this context');

    mockDispatch.mockClear();
    mockState.writer.activeTool = 'imagePrompt';
    view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });
    thunkCall = mockDispatch.mock.calls.find((call): call is [StreamGenerationThunk] =>
      isStreamGenerationThunk(call[0]),
    );
    expect(thunkCall?.[0].payload.prompt).toContain('Analyze the following scene from a story');
  });

  it('replaces generated text on accept replace action', async () => {
    mockState.writer.selection = { text: '', start: 6, end: 11 };
    mockState.writer.generationHistory = [' inserted'];
    mockState.writer.activeHistoryIndex = 0;

    const view = await createHookWrapper();
    await act(async () => {
      view.handleAccept('replace');
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'updateManuscriptSection',
      payload: { id: 's1', changes: { content: 'Hello  inserted' } },
    });
  });

  it('does nothing for unknown tool and empty prompt', async () => {
    mockState.writer.activeTool = 'unknown';

    const view = await createHookWrapper();
    await act(async () => {
      view.handleGenerate();
    });

    expect(
      mockDispatch.mock.calls.some(
        ([action]) => isDispatcherAction(action) && action.type === 'streamGenerationThunk',
      ),
    ).toBe(false);
  });

  it('updates scratchpad text and navigates history', async () => {
    const view = await createHookWrapper();
    act(() => view.handleUpdateScratchpad('edited'));
    act(() => view.handleNavigateHistory('prev'));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'updateCurrentHistoryItem',
      payload: 'edited',
    });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'navigateHistory', payload: 'prev' });
  });
});
