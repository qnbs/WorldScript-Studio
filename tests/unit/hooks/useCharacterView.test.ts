import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectActions } from '../../../features/project/projectSlice';
import { useCharacterView } from '../../../hooks/useCharacterView';
import type { Character } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — match mocks referenced in vi.mock factories
// ---------------------------------------------------------------------------
const { mockProfileMatch, mockPortraitMatch, mockRegenerateMatch } = vi.hoisted(() => ({
  mockProfileMatch: vi.fn((_: unknown) => true),
  mockPortraitMatch: vi.fn((_: unknown) => true),
  mockRegenerateMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const mockSaveImage = vi.fn().mockResolvedValue(undefined);

let mockCharacters: Character[] = [];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: { characters: Character[] }) => unknown) =>
    selector({ characters: mockCharacters }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, replacements?: Record<string, string>) => {
      if (replacements?.['name']) return `${key}:${replacements['name']}`;
      return key;
    },
    language: 'en',
  }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: (state: { characters: Character[] }) => state.characters,
}));

vi.mock('../../../features/project/thunks/characterThunks', () => {
  const profileThunk = vi.fn(() => ({ type: 'mock-profile-action' }));
  (profileThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockProfileMatch(action),
  };

  const portraitThunk = vi.fn(() => ({ type: 'mock-portrait-action' }));
  (portraitThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockPortraitMatch(action),
  };

  const regenerateThunk = vi.fn(() => ({ type: 'mock-regenerate-action' }));
  (regenerateThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockRegenerateMatch(action),
  };

  return {
    generateCharacterProfileThunk: profileThunk,
    generateCharacterPortraitThunk: portraitThunk,
    regenerateCharacterFieldThunk: regenerateThunk,
  };
});

vi.mock('../../../services/storageService', () => ({
  storageService: { saveImage: (data: unknown, name: unknown) => mockSaveImage(data, name) },
}));

// uuid always returns the same id so assertions are deterministic
vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCharacter(id: string, name = 'Alice'): Character {
  return {
    id,
    name,
    backstory: '',
    motivation: '',
    appearance: 'Tall and dark',
    personalityTraits: '',
    flaws: '',
    notes: '',
    hasAvatar: false,
    characterArc: '',
    relationships: '',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockCharacters = [];
  mockProfileMatch.mockReturnValue(true);
  mockPortraitMatch.mockReturnValue(true);
  mockRegenerateMatch.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// handleAddNewManually
// ---------------------------------------------------------------------------
describe('handleAddNewManually', () => {
  it('dispatches addCharacter', () => {
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleAddNewManually());
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addCharacter' }),
    );
  });

  it('sets selectedCharacter with the generated id', () => {
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleAddNewManually());
    expect(result.current.selectedCharacter?.id).toBe('test-uuid-1234');
  });

  it('opens the dossier', () => {
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleAddNewManually());
    expect(result.current.isDossierOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleAddNewWithAI
// ---------------------------------------------------------------------------
describe('handleAddNewWithAI', () => {
  it('opens the AI modal', () => {
    const { result } = renderHook(() => useCharacterView());
    expect(result.current.isAiModalOpen).toBe(false);
    act(() => result.current.handleAddNewWithAI());
    expect(result.current.isAiModalOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleGenerateProfile
// ---------------------------------------------------------------------------
describe('handleGenerateProfile', () => {
  it('dispatches addCharacter and calls toast.success on fulfilled', async () => {
    const newChar = makeCharacter('c-new', 'Bob');
    const fulfilledAction = {
      type: 'project/generateCharacterProfile/fulfilled',
      payload: newChar,
    };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockProfileMatch.mockReturnValue(true);

    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(mockDispatch).toHaveBeenCalledWith(projectActions.addCharacter(newChar));
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls toast.error on rejected', async () => {
    const rejectedAction = { type: 'project/generateCharacterProfile/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockProfileMatch.mockReturnValue(false);

    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isGeneratingProfile to false after completion', async () => {
    mockDispatch.mockResolvedValue({ type: 'mock', payload: makeCharacter('c1') });
    mockProfileMatch.mockReturnValue(true);

    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(result.current.isGeneratingProfile).toBe(false);
  });

  it('closes the AI modal when called', async () => {
    mockDispatch.mockResolvedValue({ type: 'mock', payload: makeCharacter('c1') });
    mockProfileMatch.mockReturnValue(true);

    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setIsAiModalOpen(true));
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(result.current.isAiModalOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleSelect
// ---------------------------------------------------------------------------
describe('handleSelect', () => {
  it('sets selectedCharacter and opens dossier', () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    expect(result.current.selectedCharacter).toEqual(char);
    expect(result.current.isDossierOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleFieldChange
// ---------------------------------------------------------------------------
describe('handleFieldChange', () => {
  it('dispatches updateCharacter with the field change', () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    act(() => result.current.handleFieldChange('backstory', 'Born in the mountains'));

    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateCharacter({ id: 'c1', changes: { backstory: 'Born in the mountains' } }),
    );
  });

  it('updates selectedCharacter local state', () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    act(() => result.current.handleFieldChange('notes', 'Some notes'));
    expect(result.current.selectedCharacter?.notes).toBe('Some notes');
  });

  it('does nothing when no character is selected', () => {
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleFieldChange('notes', 'ignored'));
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleRegenerateField
// ---------------------------------------------------------------------------
describe('handleRegenerateField', () => {
  it('does nothing when no character is selected', async () => {
    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.handleRegenerateField('backstory');
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('calls toast.error on rejected', async () => {
    const rejectedAction = { type: 'project/regenerateCharacterField/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockRegenerateMatch.mockReturnValue(false);

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleRegenerateField('backstory');
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isRegeneratingField to null after completion', async () => {
    const fulfilledAction = {
      type: 'project/regenerateCharacterField/fulfilled',
      payload: { field: 'backstory', value: 'New backstory' },
    };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockRegenerateMatch.mockReturnValue(true);

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleRegenerateField('backstory');
    });

    await waitFor(() => expect(result.current.isRegeneratingField).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// handleGeneratePortrait
// ---------------------------------------------------------------------------
describe('handleGeneratePortrait', () => {
  it('does nothing when selected character has no appearance', async () => {
    const char = { ...makeCharacter('c1'), appearance: '' };
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleGeneratePortrait();
    });
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mock-portrait-action' }),
    );
  });

  it('sets hasAvatar true on fulfilled', async () => {
    const fulfilledAction = {
      type: 'project/generateCharacterPortrait/fulfilled',
      payload: { characterId: 'c1', dataUrl: 'data:...' },
    };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockPortraitMatch.mockReturnValue(true);

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleGeneratePortrait();
    });

    expect(result.current.selectedCharacter?.hasAvatar).toBe(true);
  });

  it('sets errorMessage and calls toast.error on rejected', async () => {
    const rejectedAction = { type: 'project/generateCharacterPortrait/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockPortraitMatch.mockReturnValue(false);

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleGeneratePortrait();
    });

    expect(mockToast.error).toHaveBeenCalled();
    expect(result.current.errorMessage).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleDelete / confirmDelete
// ---------------------------------------------------------------------------
describe('handleDelete', () => {
  it('sets characterToDelete when character is found', () => {
    const char = makeCharacter('c1', 'Hero');
    mockCharacters = [char];
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleDelete('c1'));
    expect(result.current.characterToDelete).toEqual(char);
  });

  it('does nothing when character is not found', () => {
    mockCharacters = [];
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleDelete('nonexistent'));
    expect(result.current.characterToDelete).toBeNull();
  });
});

describe('confirmDelete', () => {
  it('calls storageService.saveImage and dispatches deleteCharacter', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(mockSaveImage).toHaveBeenCalledWith('c1', '');
    expect(mockDispatch).toHaveBeenCalledWith(projectActions.deleteCharacter('c1'));
  });

  it('resets state and calls toast.info after deletion', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));
    act(() => result.current.setIsDossierOpen(true));

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(result.current.characterToDelete).toBeNull();
    expect(result.current.isDossierOpen).toBe(false);
    expect(result.current.selectedCharacter).toBeNull();
    expect(mockToast.info).toHaveBeenCalled();
  });

  it('does nothing when characterToDelete is null', async () => {
    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(mockSaveImage).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
