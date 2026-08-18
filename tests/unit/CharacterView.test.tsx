import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CharacterView } from '../../components/CharacterView';
import { storageService } from '../../services/storageService';

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

vi.mock('../../services/storageService', () => ({
  storageService: {
    getImage: vi.fn().mockResolvedValue(null),
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

  // ── useStoredImage (QNBS-v3: storageService-backed, MIME-preserving) ──────

  it('renders a data:image/-prefixed avatar as-is, without re-wrapping it as PNG', async () => {
    vi.mocked(storageService.getImage).mockResolvedValueOnce('data:image/jpeg;base64,abc123');
    const { useCharacterView } = await import('../../hooks/useCharacterView');
    vi.mocked(useCharacterView).mockReturnValueOnce({
      ...baseContextValue,
      characters: [
        {
          id: 'c-jpeg',
          name: 'Jamie',
          appearance: '',
          motivation: '',
          backstory: '',
          notes: '',
          personalityTraits: '',
          hasAvatar: true,
        },
      ],
    } as never);
    render(<CharacterView />);
    const img = await waitFor(() => screen.getByAltText('Jamie'));
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,abc123');
  });

  it('falls back to a PNG data URL for a legacy raw-base64 avatar with no MIME prefix', async () => {
    vi.mocked(storageService.getImage).mockResolvedValueOnce('legacyRawBase64Payload');
    const { useCharacterView } = await import('../../hooks/useCharacterView');
    vi.mocked(useCharacterView).mockReturnValueOnce({
      ...baseContextValue,
      characters: [
        {
          id: 'c-legacy',
          name: 'Lee',
          appearance: '',
          motivation: '',
          backstory: '',
          notes: '',
          personalityTraits: '',
          hasAvatar: true,
        },
      ],
    } as never);
    render(<CharacterView />);
    const img = await waitFor(() => screen.getByAltText('Lee'));
    expect(img).toHaveAttribute('src', 'data:image/png;base64,legacyRawBase64Payload');
  });

  it('keeps the placeholder icon instead of throwing when storageService.getImage rejects', async () => {
    vi.mocked(storageService.getImage).mockRejectedValueOnce(new Error('read failed'));
    const { useCharacterView } = await import('../../hooks/useCharacterView');
    vi.mocked(useCharacterView).mockReturnValueOnce({
      ...baseContextValue,
      characters: [
        {
          id: 'c-broken',
          name: 'Robin',
          appearance: '',
          motivation: '',
          backstory: '',
          notes: '',
          personalityTraits: '',
          hasAvatar: true,
        },
      ],
    } as never);
    render(<CharacterView />);
    await waitFor(() => expect(storageService.getImage).toHaveBeenCalledWith('c-broken'));
    expect(screen.queryByAltText('Robin')).toBeNull();
  });
});
