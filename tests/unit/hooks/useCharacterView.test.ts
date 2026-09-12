import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectActions } from '../../../features/project/projectSlice';
import { useCharacterView } from '../../../hooks/useCharacterView';
import type { Character } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — match mocks referenced in vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockProfileMatch,
  mockPortraitMatch,
  mockRegenerateMatch,
  mockCaptureIdentity,
  mockIsStaleError,
} = vi.hoisted(() => ({
  mockProfileMatch: vi.fn((_: unknown) => true),
  mockPortraitMatch: vi.fn((_: unknown) => true),
  mockRegenerateMatch: vi.fn((_: unknown) => true),
  mockCaptureIdentity: vi.fn(() => 'id:test-project'),
  mockIsStaleError: vi.fn((_: unknown) => false),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const mockSaveImage = vi.fn().mockResolvedValue(undefined);
const mockDeleteImage = vi.fn().mockResolvedValue(undefined);

let mockCharacters: Character[] = [];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      characters: mockCharacters,
      project: { present: { data: { id: 'c-project-1' } } },
    }),
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
  // QNBS-v3: a real (non-'default') id so confirmDelete's deleteImage assertion actually proves the active project's own id is forwarded, not just the || 'default' fallback every project would otherwise share.
  selectProjectData: () => ({ id: 'c-project-1' }),
}));

vi.mock('../../../features/project/projectIdentity', () => ({
  captureActiveProjectIdentity: mockCaptureIdentity,
  getProjectTargetStorageId: () => 'c-project-1',
  identityUnchanged: (captured: string | null, live: string | null) =>
    captured !== null && captured === live,
  assertProjectIdentityUnchanged: (captured: string | null, live: string | null) => {
    if (captured === null || captured !== live) throw new Error('stale project operation');
  },
  isStaleProjectOperationError: mockIsStaleError,
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

// QNBS-v3: id-then-projectId argument order mirrors the reordered storageService signature.
vi.mock('../../../services/storageService', () => ({
  storageService: {
    saveImage: (id: unknown, data: unknown, projectId: unknown) =>
      mockSaveImage(id, data, projectId),
    deleteImage: (id: unknown, projectId: unknown, admission: unknown) =>
      mockDeleteImage(id, projectId, admission),
  },
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
  mockCaptureIdentity.mockReturnValue('id:test-project');
  mockIsStaleError.mockReturnValue(false);
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

  it('discards the AI-generated character if the active project changed while the request was in flight', async () => {
    // QNBS-v3: simulates a project switch (New Project/import/restore) landing between capture and re-check, the exact race the guard exists to close.
    const newChar = makeCharacter('c-new', 'Bob');
    const fulfilledAction = {
      type: 'project/generateCharacterProfile/fulfilled',
      payload: newChar,
    };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockProfileMatch.mockReturnValue(true);
    mockCaptureIdentity.mockReturnValueOnce('id:project-a').mockReturnValueOnce('id:project-b');

    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.handleGenerateProfile();
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(projectActions.addCharacter(newChar));
    expect(mockToast.success).not.toHaveBeenCalled();
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

  it('discards the regenerated field if the active project changed while the request was in flight', async () => {
    // QNBS-v3: same race as the profile-generation guard above, exercised for the field-regeneration path instead.
    const fulfilledAction = {
      type: 'project/regenerateCharacterField/fulfilled',
      payload: { field: 'backstory', value: 'New backstory' },
    };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockRegenerateMatch.mockReturnValue(true);
    mockCaptureIdentity.mockReturnValueOnce('id:project-a').mockReturnValueOnce('id:project-b');

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleRegenerateField('backstory');
    });

    expect(mockDispatch).not.toHaveBeenCalledWith(
      projectActions.updateCharacter({ id: 'c1', changes: { backstory: 'New backstory' } }),
    );
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

  it('silently discards stale portrait results without marking an avatar', async () => {
    mockDispatch.mockResolvedValue({
      type: 'project/generateCharacterPortrait/rejected',
      error: { name: 'StaleProjectOperationError' },
    });
    mockPortraitMatch.mockReturnValue(false);
    mockIsStaleError.mockReturnValue(true);

    const char = makeCharacter('c1');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.handleSelect(char));
    await act(async () => {
      await result.current.handleGeneratePortrait();
    });

    expect(result.current.selectedCharacter?.hasAvatar).toBe(false);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('silently discards a stale refined portrait result', async () => {
    mockDispatch.mockResolvedValue({
      type: 'project/generateCharacterPortrait/rejected',
      error: { name: 'StaleProjectOperationError' },
    });
    mockPortraitMatch.mockReturnValue(false);
    mockIsStaleError.mockReturnValue(true);

    const { result } = renderHook(() => useCharacterView());
    act(() => {
      result.current.handleSelect(makeCharacter('c1'));
      result.current.setRefinementPrompt('more detail');
    });
    await act(async () => {
      await result.current.handleRefinePortrait();
    });

    expect(mockToast.error).not.toHaveBeenCalled();
    expect(result.current.isRefiningPortrait).toBe(false);
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
  it('calls storageService.deleteImage and dispatches deleteCharacter', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));

    await act(async () => {
      await result.current.confirmDelete();
    });

    // QNBS-v3: asserts the real active project id (not a hardcoded fallback every project would share) is forwarded to deleteImage.
    expect(mockDeleteImage).toHaveBeenCalledWith('c1', 'c-project-1', expect.any(Function));
    expect(mockDispatch).toHaveBeenCalledWith(projectActions.deleteCharacter('c1'));
    const admission = mockDeleteImage.mock.calls[0]?.[2] as (() => void) | undefined;
    admission?.();
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

  it('clears a stale delete confirmation without dispatching a deletion', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));
    mockIsStaleError.mockReturnValue(true);
    mockDeleteImage.mockRejectedValueOnce({ name: 'StaleProjectOperationError' });

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(result.current.characterToDelete).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalledWith(projectActions.deleteCharacter('c1'));
  });

  it('clears the confirmation and shows an error when image deletion fails', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));
    mockDeleteImage.mockRejectedValueOnce(new Error('storage failed'));

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(result.current.characterToDelete).toBeNull();
    expect(mockToast.error).toHaveBeenCalledWith('error.apiErrorTitle');
    expect(mockDispatch).not.toHaveBeenCalledWith(projectActions.deleteCharacter('c1'));
  });

  it('clears a confirmation when the active project changes before delete starts', async () => {
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(makeCharacter('c1')));
    mockCaptureIdentity.mockReturnValue('id:replacement');

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(result.current.characterToDelete).toBeNull();
    expect(mockDeleteImage).not.toHaveBeenCalled();
  });

  it('clears a confirmation when the active project changes after storage', async () => {
    const char = makeCharacter('c1', 'Hero');
    const { result } = renderHook(() => useCharacterView());
    act(() => result.current.setCharacterToDelete(char));
    mockDeleteImage.mockImplementationOnce(async () => {
      mockCaptureIdentity.mockReturnValue('id:replacement');
    });

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(result.current.characterToDelete).toBeNull();
    expect(mockDispatch).not.toHaveBeenCalledWith(projectActions.deleteCharacter('c1'));
  });

  it('does nothing when characterToDelete is null', async () => {
    const { result } = renderHook(() => useCharacterView());
    await act(async () => {
      await result.current.confirmDelete();
    });
    expect(mockDeleteImage).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
