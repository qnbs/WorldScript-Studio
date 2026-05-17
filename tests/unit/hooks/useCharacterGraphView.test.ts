import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharacterGraphView } from '../../../hooks/useCharacterGraphView';
import type { Character, CharacterRelationship } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

let mockCharacters: Character[] = [];
let mockProjectData: { relationships?: CharacterRelationship[] } | null = null;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      project: { present: { data: mockProjectData } },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => mockCharacters,
  selectProjectData: (state: { project: { present: { data: unknown } } }) =>
    state.project.present.data,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCharacter(id: string, name = 'Alice'): Character {
  return {
    id,
    name,
    backstory: '',
    motivation: '',
    appearance: '',
    personalityTraits: '',
    flaws: '',
    notes: '',
    hasAvatar: false,
    characterArc: '',
    relationships: '',
  };
}

function makeRelationship(id: string): CharacterRelationship {
  return {
    id,
    fromCharacterId: 'c1',
    toCharacterId: 'c2',
    type: 'friend',
    strength: 5,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockReturnValue({ type: 'mock-action' });
  mockCharacters = [];
  mockProjectData = null;
});

// ---------------------------------------------------------------------------
// characters selector
// ---------------------------------------------------------------------------
describe('characters', () => {
  it('returns characters from selector', () => {
    mockCharacters = [makeCharacter('c1')];
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.characters).toHaveLength(1);
    expect(result.current.characters[0]?.id).toBe('c1');
  });

  it('returns empty array when no characters', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.characters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// relationships derived from projectData
// ---------------------------------------------------------------------------
describe('relationships', () => {
  it('returns relationships from projectData', () => {
    mockProjectData = { relationships: [makeRelationship('r1')] };
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.relationships).toHaveLength(1);
    expect(result.current.relationships[0]?.id).toBe('r1');
  });

  it('returns empty array when projectData is null', () => {
    mockProjectData = null;
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.relationships).toHaveLength(0);
  });

  it('returns empty array when relationships property is missing', () => {
    mockProjectData = {};
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.relationships).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// onAddRelationship
// ---------------------------------------------------------------------------
describe('onAddRelationship', () => {
  it('dispatches addRelationship with correct fields', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    act(() => {
      result.current.onAddRelationship('c1', 'c2', 'enemy', 8);
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/addRelationship',
        payload: expect.objectContaining({
          fromCharacterId: 'c1',
          toCharacterId: 'c2',
          type: 'enemy',
          strength: 8,
        }),
      }),
    );
  });

  it('generates a unique id starting with rel_', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    act(() => {
      result.current.onAddRelationship('c1', 'c2', 'ally', 3);
    });
    const dispatched = mockDispatch.mock.calls[0]?.[0];
    expect(dispatched?.payload?.id).toMatch(/^rel_/);
  });
});

// ---------------------------------------------------------------------------
// onUpdateRelationship
// ---------------------------------------------------------------------------
describe('onUpdateRelationship', () => {
  it('dispatches updateRelationship with id and changes', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    act(() => {
      result.current.onUpdateRelationship('r1', { strength: 9 });
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateRelationship',
        payload: { id: 'r1', changes: { strength: 9 } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// onDeleteRelationship
// ---------------------------------------------------------------------------
describe('onDeleteRelationship', () => {
  it('dispatches deleteRelationship with the relationship id', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    act(() => {
      result.current.onDeleteRelationship('r1');
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/deleteRelationship',
        payload: 'r1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// onConnect (default relationship)
// ---------------------------------------------------------------------------
describe('onConnect', () => {
  it('calls onAddRelationship with type friend and strength 5', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    act(() => {
      result.current.onConnect('c1', 'c2');
    });
    const dispatched = mockDispatch.mock.calls[0]?.[0];
    expect(dispatched?.payload?.type).toBe('friend');
    expect(dispatched?.payload?.strength).toBe(5);
    expect(dispatched?.payload?.fromCharacterId).toBe('c1');
    expect(dispatched?.payload?.toCharacterId).toBe('c2');
  });
});

// ---------------------------------------------------------------------------
// t (translation passthrough)
// ---------------------------------------------------------------------------
describe('translation', () => {
  it('exposes t function that returns the key', () => {
    const { result } = renderHook(() => useCharacterGraphView());
    expect(result.current.t('some.key')).toBe('some.key');
  });
});
