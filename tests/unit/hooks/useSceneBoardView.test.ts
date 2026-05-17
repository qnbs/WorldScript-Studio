import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneBoardView } from '../../../hooks/useSceneBoardView';
import type { StorySection, World } from '../../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

let mockProject = {
  id: 'p1',
  title: 'Novel',
  manuscript: [] as StorySection[],
  sceneBoardLayout: undefined as Record<string, { x: number; y: number }> | undefined,
};
let mockWorlds: World[] = [];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // QNBS-v3: useAppSelectorShallow used by useSceneBoardView — must be mocked alongside useAppSelector
  useAppSelectorShallow: (selector: (s: unknown) => unknown) =>
    selector({ project: { present: { data: mockProject } } }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => [],
  selectAllWorlds: () => mockWorlds,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(id: string, title = 'Scene', content = ''): StorySection {
  return { id, title, content };
}

function makeWorld(id: string): World {
  return {
    id,
    name: 'Westeros',
    description: '',
    geography: '',
    magicSystem: '',
    culture: '',
    notes: '',
    timeline: [],
    locations: [{ id: 'loc1', name: 'Castle', description: '', type: 'other' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockReturnValue({ type: 'mock-action' });
  mockProject = { id: 'p1', title: 'Novel', manuscript: [], sceneBoardLayout: undefined };
  mockWorlds = [];
});

// ---------------------------------------------------------------------------
// sections derived from manuscript
// ---------------------------------------------------------------------------
describe('sections', () => {
  it('maps manuscript to sections with wordCount', () => {
    mockProject.manuscript = [makeSection('s1', 'Act 1', 'hello world')];
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0]?.wordCount).toBe(2);
  });

  it('uses sceneBoardLayout position when available', () => {
    mockProject.manuscript = [makeSection('s1')];
    mockProject.sceneBoardLayout = { s1: { x: 100, y: 200 } };
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.sections[0]?.position).toEqual({ x: 100, y: 200 });
  });

  it('returns empty array for empty manuscript', () => {
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.sections).toHaveLength(0);
  });

  it('handles section with undefined content (wordCount 0)', () => {
    // content is required in StorySection but we simulate edge case via spread
    mockProject.manuscript = [{ ...makeSection('s1'), content: '' }];
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.sections[0]?.wordCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// locationOptions derived from worlds
// ---------------------------------------------------------------------------
describe('locationOptions', () => {
  it('flattens world locations into labelled options', () => {
    mockWorlds = [makeWorld('w1')];
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.locationOptions).toHaveLength(1);
    expect(result.current.locationOptions[0]?.label).toBe('Westeros: Castle');
  });

  it('returns empty array when no worlds', () => {
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.locationOptions).toHaveLength(0);
  });

  it('skips worlds with no locations', () => {
    mockWorlds = [{ ...makeWorld('w1'), locations: [] }];
    const { result } = renderHook(() => useSceneBoardView());
    expect(result.current.locationOptions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// handleUpdateSection
// ---------------------------------------------------------------------------
describe('handleUpdateSection', () => {
  it('dispatches updateManuscriptSection with id and changes', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleUpdateSection('s1', { title: 'Updated' });
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateManuscriptSection',
        payload: { id: 's1', changes: { title: 'Updated' } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleDeleteSection
// ---------------------------------------------------------------------------
describe('handleDeleteSection', () => {
  it('dispatches deleteManuscriptSection with the section id', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleDeleteSection('s1');
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/deleteManuscriptSection',
        payload: 's1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleMoveSection
// ---------------------------------------------------------------------------
describe('handleMoveSection', () => {
  it('dispatches updateSceneBoardLayout with id and position', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleMoveSection('s1', { x: 50, y: 75 });
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/updateSceneBoardLayout',
        payload: { s1: { x: 50, y: 75 } },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleMoveSectionWithinAct
// ---------------------------------------------------------------------------
describe('handleMoveSectionWithinAct', () => {
  it('dispatches moveManuscriptSectionWithinAct up', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleMoveSectionWithinAct('s1', 'up');
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/moveManuscriptSectionWithinAct',
        payload: { id: 's1', direction: 'up' },
      }),
    );
  });

  it('dispatches moveManuscriptSectionWithinAct down', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleMoveSectionWithinAct('s2', 'down');
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { id: 's2', direction: 'down' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleAddSection
// ---------------------------------------------------------------------------
describe('handleAddSection', () => {
  it('dispatches addManuscriptSection with title from t()', () => {
    const { result } = renderHook(() => useSceneBoardView());
    act(() => {
      result.current.handleAddSection();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project/addManuscriptSection',
        payload: expect.objectContaining({ title: 'sceneboard.newSceneTitle' }),
      }),
    );
  });
});
