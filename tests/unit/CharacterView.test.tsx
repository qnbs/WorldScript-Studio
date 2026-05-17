import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../../components/CharacterView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleAddNewManually = vi.fn();
const mockHandleAddNewWithAI = vi.fn();
const mockHandleSelect = vi.fn();
const mockConfirmDelete = vi.fn();

const baseContextValue = {
  t: (k: string) => k,
  characters: [],
  selectedCharacter: null,
  isDossierOpen: false,
  setIsDossierOpen: vi.fn(),
  handleSelect: mockHandleSelect,
  handleAddNewManually: mockHandleAddNewManually,
  handleAddNewWithAI: mockHandleAddNewWithAI,
  handleUpdateCharacter: vi.fn(),
  handleGenerateCharacter: vi.fn(),
  isGeneratingCharacter: false,
  characterToDelete: null,
  setCharacterToDelete: vi.fn(),
  confirmDelete: mockConfirmDelete,
  handleGeneratePortrait: vi.fn(),
  isGeneratingPortrait: false,
  portraitStyle: 'photorealistic',
  setPortraitStyle: vi.fn(),
  isRefiningDossier: false,
  handleRefineDossier: vi.fn(),
  dossierRefinementPrompt: '',
  setDossierRefinementPrompt: vi.fn(),
  aiGenerationFields: {},
  setAiGenerationFields: vi.fn(),
  isAiModalOpen: false,
  setIsAiModalOpen: vi.fn(),
  aiGenerationForm: {},
  setAiGenerationForm: vi.fn(),
  handleAiGenerate: vi.fn(),
  isGeneratingWithAI: false,
};

vi.mock('../../hooks/useCharacterView', () => ({
  useCharacterView: vi.fn(() => baseContextValue),
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
    getCharacterImage: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../features/project/thunks/characterThunks', () => ({
  uploadCharacterImageThunk: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CharacterView', () => {
  it('renders without throwing', () => {
    expect(() => render(<CharacterView />)).not.toThrow();
  });

  it('shows add manually button', () => {
    render(<CharacterView />);
    expect(screen.getByText('characters.addNewManually')).toBeTruthy();
  });

  it('shows add with AI button', () => {
    render(<CharacterView />);
    expect(screen.getByText('characters.addNewWithAI')).toBeTruthy();
  });

  it('shows character cards when characters exist', async () => {
    const { useCharacterView } = await import('../../hooks/useCharacterView');
    vi.mocked(useCharacterView).mockReturnValueOnce({
      ...baseContextValue,
      characters: [
        {
          id: 'c1',
          name: 'Alice',
          appearance: '',
          motivation: '',
          backstory: '',
          notes: '',
          personalityTraits: 'brave',
          hasAvatar: false,
        },
      ],
    } as never);
    render(<CharacterView />);
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows no character cards when empty', () => {
    render(<CharacterView />);
    const cards = screen.queryAllByRole('button', { name: /characters/ });
    // Only AddNewCard buttons + no character cards
    expect(cards.length).toBeLessThanOrEqual(2);
  });
});
