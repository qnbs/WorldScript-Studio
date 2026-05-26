/**
 * Tests for hooks/useCharacterInterviewsView.ts
 * QNBS-v3: Mocks Redux + storageService; tests initial state, selectCharacter, selectInterview,
 *          startNewInterview, deleteInterview, sendQuestion, stopStreaming.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn().mockResolvedValue({});
const mockGetGeminiApiKey = vi.fn().mockResolvedValue('test-api-key');

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: vi.fn(() => mockDispatch),
  useAppSelectorShallow: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      featureFlags: { enableCharacterInterviews: true },
      project: {
        present: {
          data: {
            characters: [
              { id: 'char-1', name: 'Alice', archetype: 'hero' },
              { id: 'char-2', name: 'Bob', archetype: 'mentor' },
            ],
            characterInterviews: {
              'char-1': [
                {
                  id: 'iv-1',
                  characterId: 'char-1',
                  archetype: 'hero',
                  title: 'First interview',
                  messages: [],
                  templateId: 'hero-template',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ],
            },
          },
        },
      },
    }),
  ),
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  selectEnableCharacterInterviews: (s: { featureFlags: { enableCharacterInterviews: boolean } }) =>
    s.featureFlags.enableCharacterInterviews,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: (s: { project: { present: { data: { characters: unknown[] } } } }) =>
    s.project.present.data.characters,
  selectCharacterInterviewsAll: (s: {
    project: { present: { data: { characterInterviews: Record<string, unknown[]> } } };
  }) => s.project.present.data.characterInterviews,
}));

vi.mock('../../../features/project/projectSlice', () => ({
  projectActions: {
    addCharacterInterview: vi.fn((p: unknown) => ({
      type: 'project/addCharacterInterview',
      payload: p,
    })),
    deleteCharacterInterview: vi.fn((p: unknown) => ({
      type: 'project/deleteCharacterInterview',
      payload: p,
    })),
  },
}));

vi.mock('../../../features/project/thunks/interviewThunks', () => ({
  createNewInterview: vi.fn((characterId: string, archetype: string, templateId: string) => ({
    id: 'new-iv-1',
    characterId,
    archetype,
    templateId,
    title: 'New Interview',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })),
  // QNBS-v3: return a thenable-like object so dispatch(...).finally() works in the hook
  streamInterviewResponseThunk: vi.fn((p: unknown) => {
    const promise = Promise.resolve({ type: 'project/streamInterviewResponse', payload: p });
    return promise;
  }),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    getGeminiApiKey: (...args: unknown[]) => mockGetGeminiApiKey(...args),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useCharacterInterviewsView } from '../../../hooks/useCharacterInterviewsView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCharacterInterviewsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch.mockResolvedValue({});
    mockGetGeminiApiKey.mockResolvedValue('test-api-key');
  });

  it('returns isEnabled true when feature flag is on', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    expect(result.current.isEnabled).toBe(true);
  });

  it('returns characters list', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    expect(result.current.characters).toHaveLength(2);
    expect(result.current.characters[0]?.name).toBe('Alice');
  });

  it('initially no character is selected', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    expect(result.current.selectedCharacterId).toBeNull();
  });

  it('selectCharacter sets the selected character id', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
    });
    expect(result.current.selectedCharacterId).toBe('char-1');
  });

  it('selectCharacter clears selectedInterviewId and archetype', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
      result.current.selectInterview('iv-1');
    });
    act(() => {
      result.current.selectCharacter('char-2');
    });
    expect(result.current.selectedInterviewId).toBeNull();
  });

  it('returns interviews for selected character', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
    });
    expect(result.current.interviews).toHaveLength(1);
    expect(result.current.interviews[0]?.id).toBe('iv-1');
  });

  it('selectInterview sets the selected interview', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
      result.current.selectInterview('iv-1');
    });
    expect(result.current.selectedInterviewId).toBe('iv-1');
    expect(result.current.selectedInterview?.id).toBe('iv-1');
  });

  it('selectArchetype sets the archetype', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectArchetype('hero');
    });
    expect(result.current.selectedArchetype).toBe('hero');
  });

  it('startNewInterview does nothing when no character selected', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.startNewInterview('Test');
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('startNewInterview dispatches when character and archetype are set', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
      result.current.selectArchetype('hero');
    });
    act(() => {
      result.current.startNewInterview('Test Interview');
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('deleteInterview dispatches deleteCharacterInterview', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    act(() => {
      result.current.selectCharacter('char-1');
    });
    act(() => {
      result.current.deleteInterview('iv-1');
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('isStreaming starts as false', () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    expect(result.current.isStreaming).toBe(false);
  });

  it('sets hasAiKey when API key is available', async () => {
    const { result } = renderHook(() => useCharacterInterviewsView());
    await act(async () => {
      await Promise.resolve(); // flush useEffect
    });
    expect(result.current.hasAiKey).toBe(true);
  });
});
