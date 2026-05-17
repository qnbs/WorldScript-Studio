import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SceneBoardView } from '../../components/SceneBoardView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../hooks/useSceneBoardView', () => ({
  useSceneBoardView: vi.fn(() => ({
    t: (k: string) => k,
    project: {
      title: 'Test Project',
      manuscript: [],
      outline: [],
      characters: { ids: [], entities: {} },
      worlds: { ids: [], entities: {} },
      logline: '',
      genre: '',
      sceneBoardLayout: {},
    },
    sections: [],
    characters: [],
    locationOptions: [],
    handleUpdateSection: vi.fn(),
    handleDeleteSection: vi.fn(),
    handleMoveSection: vi.fn(),
    handleMoveSectionWithinAct: vi.fn(),
    handleAddSection: vi.fn(),
  })),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
  useAppSelectorShallow: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ settings: { editorFont: 'serif', fontSize: 16, lineSpacing: 1.5 } }),
  ),
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

vi.mock('../../services/sceneTimelineRules', () => ({
  evaluateSceneTimeline: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SceneBoardView', () => {
  it('renders without throwing', () => {
    expect(() => render(<SceneBoardView />)).not.toThrow();
  });

  it('shows the sceneboard title', () => {
    render(<SceneBoardView />);
    expect(screen.getByText('sceneboard.title')).toBeTruthy();
  });

  it('shows add scene button', () => {
    render(<SceneBoardView />);
    expect(screen.getByText('sceneboard.addScene')).toBeTruthy();
  });

  it('shows scene count when sections exist', async () => {
    const { useSceneBoardView } = await import('../../hooks/useSceneBoardView');
    vi.mocked(useSceneBoardView).mockReturnValueOnce({
      t: (k: string) => k,
      project: {
        title: 'Test Project',
        manuscript: [],
        outline: [],
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
        logline: '',
        genre: '',
        sceneBoardLayout: {},
      },
      sections: [
        {
          id: 's1',
          title: 'Opening',
          content: 'Once upon a time',
          position: { x: 0, y: 0 },
          wordCount: 4,
        },
      ],
      characters: [],
      locationOptions: [],
      handleUpdateSection: vi.fn(),
      handleDeleteSection: vi.fn(),
      handleMoveSection: vi.fn(),
      handleMoveSectionWithinAct: vi.fn(),
      handleAddSection: vi.fn(),
    } as never);
    render(<SceneBoardView />);
    // Section count appears in the header
    const cells = screen.getAllByText(/sceneboard\.scenes/);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('shows drag empty hint when no sections', () => {
    render(<SceneBoardView />);
    const hints = screen.getAllByText('sceneboard.dragEmptyHint');
    expect(hints.length).toBeGreaterThan(0);
  });
});
