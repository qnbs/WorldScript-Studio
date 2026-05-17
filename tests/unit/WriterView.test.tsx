import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WriterView } from '../../components/WriterView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectData = {
  title: 'My Novel',
  logline: '',
  genre: 'Fantasy',
  manuscript: [{ id: 's1', title: 'Opening Scene', content: '' }],
  outline: [],
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
};

const mockDispatch = vi.fn();

const baseContextValue = {
  t: (k: string) => k,
  project: mockProjectData,
  writerState: {
    currentAiResult: '',
    isGenerating: false,
    isLoading: false,
    scratchpad: '',
    generationHistory: [],
    activeHistoryIndex: -1,
    currentHistoryIndex: -1,
    activeTool: 'continue' as const,
    selection: { start: 0, end: 0, text: '' },
    dialogueCharacters: '',
    scenario: '',
    brainstormContext: '',
    tone: '',
    style: '',
  },
  selectedSectionId: null,
  dispatch: mockDispatch,
  handleContentChange: vi.fn(),
  isGenerateDisabled: vi.fn(() => false),
  handleGenerate: vi.fn(),
  handleNavigateHistory: vi.fn(),
  handleUpdateScratchpad: vi.fn(),
  handleAccept: vi.fn(),
};

vi.mock('../../hooks/useWriterView', () => ({
  useWriterView: vi.fn(() => baseContextValue),
}));

vi.mock('../../hooks/useTTS', () => ({
  useTTS: vi.fn(() => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: false,
  })),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: {
        editorFont: 'serif',
        fontSize: 16,
        lineSpacing: 1.5,
        aiCreativity: 'Balanced',
        advancedAi: {},
      },
      versionControl: { isPanelOpen: false },
    }),
  ),
  useAppSelectorShallow: vi.fn(),
}));

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: vi.fn(() => ({
    isListening: false,
    transcript: '',
    toggleListening: vi.fn(),
    setTranscript: vi.fn(),
  })),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../features/versionControl/versionControlSlice', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../features/versionControl/versionControlSlice')>();
  return {
    ...original,
    selectIsPanelOpen: vi.fn(() => false),
  };
});

vi.mock('../../components/VersionControlPanel', () => ({
  VersionControlPanel: () => null,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WriterView', () => {
  it('renders without throwing', () => {
    expect(() => render(<WriterView />)).not.toThrow();
  });

  it('shows context panel title', () => {
    render(<WriterView />);
    const items = screen.getAllByText('writer.studio.context.title');
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows section selector', () => {
    render(<WriterView />);
    expect(screen.getByText('writer.studio.context.sectionLabel')).toBeTruthy();
  });

  it('shows the generate button', () => {
    render(<WriterView />);
    // At least one tool button should be visible
    const toolBtns = screen.getAllByRole('button');
    expect(toolBtns.length).toBeGreaterThan(0);
  });

  it('shows manuscript section in selector', () => {
    render(<WriterView />);
    expect(screen.getByText('Opening Scene')).toBeTruthy();
  });

  it('shows tools title in tools panel', () => {
    render(<WriterView />);
    // QNBS-v3: responsive layout may render panels multiple times (mobile/desktop)
    expect(screen.getAllByText('writer.studio.tools.title').length).toBeGreaterThan(0);
  });

  it('shows tool buttons in tools panel', () => {
    render(<WriterView />);
    // Tool buttons use aria-label — may appear multiple times in responsive layouts
    expect(screen.getAllByLabelText('writer.studio.tools.continue.title').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByLabelText('writer.studio.tools.improve.title').length).toBeGreaterThan(0);
  });

  it('shows AI result title', () => {
    render(<WriterView />);
    expect(screen.getAllByText('writer.studio.result.title').length).toBeGreaterThan(0);
  });

  it('shows generate button (common.generate)', () => {
    render(<WriterView />);
    // Generate button uses common.generate key
    expect(screen.getAllByText('common.generate').length).toBeGreaterThan(0);
  });

  it('shows AI result placeholder when no result', () => {
    render(<WriterView />);
    // Placeholder shown when generationHistory is empty
    const placeholder = screen.queryByPlaceholderText('writer.studio.result.placeholder');
    expect(placeholder).toBeTruthy();
  });

  it('shows continue tool instruction when activeTool is continue', () => {
    render(<WriterView />);
    expect(screen.getAllByText('writer.studio.tools.continue.instruction').length).toBeGreaterThan(
      0,
    );
  });

  it('dispatches setActiveTool when a tool button is clicked', () => {
    render(<WriterView />);
    // Click the first improve tool button (may be in tool group)
    const btns = screen.getAllByLabelText('writer.studio.tools.improve.title');
    fireEvent.click(btns[0] as HTMLElement);
    expect(mockDispatch).toHaveBeenCalled();
  });
});
