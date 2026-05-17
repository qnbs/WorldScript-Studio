import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorldView } from '../../components/WorldView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const baseContextValue = {
  t: (k: string) => k,
  worlds: [],
  selectedWorld: null,
  setSelectedWorld: vi.fn(),
  isAtlasOpen: false,
  setIsAtlasOpen: vi.fn(),
  isAiModalOpen: false,
  setIsAiModalOpen: vi.fn(),
  aiConcept: '',
  setAiConcept: vi.fn(),
  isGeneratingProfile: false,
  isRegeneratingField: null,
  isGeneratingImage: false,
  isRefiningImage: false,
  refinementPrompt: '',
  setRefinementPrompt: vi.fn(),
  worldToDelete: null,
  setWorldToDelete: vi.fn(),
  handleAddNewManually: vi.fn(),
  handleAddNewWithAI: vi.fn(),
  handleGenerateProfile: vi.fn(),
  handleSelect: vi.fn(),
  handleFieldChange: vi.fn(),
  handleRegenerateField: vi.fn(),
  handleGenerateImage: vi.fn(),
  handleRefineImage: vi.fn(),
  handleDelete: vi.fn(),
  confirmDelete: vi.fn(),
  addTimelineEvent: vi.fn(),
  deleteTimelineEvent: vi.fn(),
  handleTimelineChange: vi.fn(),
  addLocation: vi.fn(),
  deleteLocation: vi.fn(),
  handleLocationChange: vi.fn(),
};

vi.mock('../../hooks/useWorldView', () => ({
  useWorldView: vi.fn(() => baseContextValue),
}));

vi.mock('../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
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

vi.mock('../../services/dbService', () => ({
  dbService: {
    getWorldImage: vi.fn().mockResolvedValue(null),
    getCharacterImage: vi.fn().mockResolvedValue(null),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorldView', () => {
  it('renders without throwing', () => {
    expect(() => render(<WorldView />)).not.toThrow();
  });

  it('shows add world manually button', () => {
    render(<WorldView />);
    expect(screen.getByText('worlds.addNewManually')).toBeTruthy();
  });

  it('shows add world with AI button', () => {
    render(<WorldView />);
    expect(screen.getByText('worlds.addNewWithAI')).toBeTruthy();
  });

  it('shows world card when worlds exist', async () => {
    const { useWorldView } = await import('../../hooks/useWorldView');
    vi.mocked(useWorldView).mockReturnValueOnce({
      ...baseContextValue,
      worlds: [
        {
          id: 'w1',
          name: 'Middle Earth',
          description: 'A fantasy world',
          geography: 'Mountains and plains',
          magicSystem: 'None',
          notes: '',
          hasImage: false,
          locations: [],
          timeline: [],
        },
      ],
    } as never);
    render(<WorldView />);
    expect(screen.getByText('Middle Earth')).toBeTruthy();
  });

  it('shows empty state when no worlds', () => {
    render(<WorldView />);
    // Only the two AddNewCard buttons visible
    const addBtns = screen.getAllByText(/worlds\.addNew/);
    expect(addBtns.length).toBeGreaterThanOrEqual(2);
  });
});
