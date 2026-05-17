import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManuscriptView } from '../../components/ManuscriptView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectData = {
  title: 'Test Story',
  logline: 'A test logline',
  genre: 'Fantasy',
  manuscript: [{ id: 'm1', title: 'Chapter 1', content: 'Hello world.' }],
  outline: [],
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
  compileProfile: null,
  sceneBoardLayout: {},
};

const baseContextValue = {
  t: (k: string) => k,
  project: mockProjectData,
  manuscript: [{ id: 'm1', title: 'Chapter 1', content: 'Hello world.' }],
  characters: [],
  worlds: [],
  dispatch: vi.fn(),
  activeSectionId: null,
  setActiveSectionId: vi.fn(),
  activeSection: null,
  activeSectionStats: { wordCount: 0, charCount: 0, readTime: 0 },
  handleContentChange: vi.fn(),
  handleTitleChange: vi.fn(),
  handleAddSection: vi.fn(),
  handleDeleteSection: vi.fn(),
  isLoglineModalOpen: false,
  setIsLoglineModalOpen: vi.fn(),
  loglineSuggestions: [],
  isAiLoading: false,
  handleGenerateLoglines: vi.fn(),
  selectLogline: vi.fn(),
  draggedItem: { current: null },
  dragOverItem: { current: null },
  handleDragSort: vi.fn(),
  handleMoveSection: vi.fn(),
  draggingIndex: null,
  setDraggingIndex: vi.fn(),
  mentions: [],
  mentionPosition: null,
  handleMentionSelect: vi.fn(),
  editorRef: { current: null },
  isProofreading: false,
  handleProofread: vi.fn(),
  proofreadSuggestions: [],
  applyProofreadSuggestion: vi.fn(),
  isSceneVisualizing: false,
  handleVisualizeScene: vi.fn(),
  sceneImagePreviewUrl: null,
};

vi.mock('../../hooks/useManuscriptView', () => ({
  useManuscriptView: vi.fn(() => baseContextValue),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 },
      featureFlags: { enableCompileWizard: false, enableManuscriptResearchSplit: false },
      versionControl: { snapshots: [], currentBranchId: 'main', branches: [], isPanelOpen: false },
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

vi.mock('../../contexts/CommandExecutorContext', () => ({
  useCommandExecutor: vi.fn(() => ({
    executeCommand: vi.fn(),
    runCommandById: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManuscriptView', () => {
  it('renders without throwing', () => {
    expect(() => render(<ManuscriptView />)).not.toThrow();
  });

  it('shows add section button', () => {
    render(<ManuscriptView />);
    const items = screen.getAllByText('manuscript.addSection');
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows section title in sidebar', () => {
    render(<ManuscriptView />);
    const items = screen.getAllByText('Chapter 1');
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows empty editor prompt when no active section', () => {
    render(<ManuscriptView />);
    const items = screen.getAllByText('manuscript.select');
    expect(items.length).toBeGreaterThan(0);
  });

  it('shows active section content when section selected', async () => {
    const { useManuscriptView } = await import('../../hooks/useManuscriptView');
    vi.mocked(useManuscriptView).mockReturnValueOnce({
      ...baseContextValue,
      activeSectionId: 'm1',
      activeSection: { id: 'm1', title: 'Chapter 1', content: 'Hello world.' },
      activeSectionStats: { wordCount: 2, charCount: 11, readTime: 0 },
    } as never);
    render(<ManuscriptView />);
    // Title field shows active section title
    const titleInputs = screen.getAllByDisplayValue('Chapter 1');
    expect(titleInputs.length).toBeGreaterThan(0);
  });

  it('shows word count stats for active section', async () => {
    const { useManuscriptView } = await import('../../hooks/useManuscriptView');
    vi.mocked(useManuscriptView).mockReturnValueOnce({
      ...baseContextValue,
      activeSectionId: 'm1',
      activeSection: { id: 'm1', title: 'Chapter 1', content: 'Hello world.' },
      activeSectionStats: { wordCount: 2, charCount: 11, readTime: 1 },
    } as never);
    render(<ManuscriptView />);
    const statsTitles = screen.getAllByText('manuscript.inspector.statsTitle');
    expect(statsTitles.length).toBeGreaterThan(0);
  });
});
