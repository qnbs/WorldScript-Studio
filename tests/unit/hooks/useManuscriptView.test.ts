import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectActions } from '../../../features/project/projectSlice';
import { useManuscriptView } from '../../../hooks/useManuscriptView';
import type { StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — must be before vi.mock blocks
// ---------------------------------------------------------------------------
const { mockProofreadMatch } = vi.hoisted(() => ({
  mockProofreadMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockUnwrap = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

// Shared mutable state consumed by useAppSelector
const mockState = {
  project: {
    present: {
      data: {
        id: 'p1',
        title: 'My Novel',
        logline: '',
        manuscript: [] as StorySection[],
      },
    },
  },
  characters: [] as { id: string; name: string }[],
  worlds: [] as { id: string; name: string }[],
};

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: (state: typeof mockState) => state.project.present.data,
  selectAllCharacters: (state: typeof mockState) => state.characters,
  selectAllWorlds: (state: typeof mockState) => state.worlds,
}));

vi.mock('../../../features/project/thunks/writingThunks', () => {
  const proofreadThunk = vi.fn(() => ({ type: 'mock-proofread-action' }));
  // QNBS-v3: attach .fulfilled.match so hook's RTK pattern check works in tests
  (proofreadThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockProofreadMatch(action),
  };
  return {
    generateLoglineSuggestionsThunk: vi.fn(() => ({ type: 'mock-logline-action' })),
    proofreadTextThunk: proofreadThunk,
    generateSceneImageThunk: vi.fn(() => ({ type: 'mock-scene-action' })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(id: string, title: string, content: string): StorySection {
  return { id, title, content };
}

const onNavigate = vi.fn();

function setManuscript(sections: StorySection[]) {
  mockState.project.present.data.manuscript = sections;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockReturnValue({ unwrap: mockUnwrap });
  mockUnwrap.mockResolvedValue(undefined);
  mockProofreadMatch.mockReturnValue(true);
  setManuscript([makeSection('s1', 'Chapter 1', 'Hello world foo')]);
  mockState.characters = [];
  mockState.worlds = [];
});

// ---------------------------------------------------------------------------
// activeSection / activeSectionStats
// ---------------------------------------------------------------------------
describe('activeSection', () => {
  it('defaults to the first section', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    expect(result.current.activeSection?.id).toBe('s1');
  });

  it('updates when activeSectionId changes', () => {
    setManuscript([makeSection('s1', 'Chapter 1', 'foo'), makeSection('s2', 'Chapter 2', 'bar')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.setActiveSectionId('s2'));
    expect(result.current.activeSection?.id).toBe('s2');
  });
});

describe('activeSectionStats', () => {
  it('returns zeros when there is no active section', () => {
    setManuscript([]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    expect(result.current.activeSectionStats).toEqual({ wordCount: 0, charCount: 0, readTime: 0 });
  });

  it('counts words, chars, and readTime for active section', () => {
    // 225-word threshold: 1 word → readTime = ceil(1/225) = 1 min
    setManuscript([makeSection('s1', 'Ch1', 'one two three')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    expect(result.current.activeSectionStats.wordCount).toBe(3);
    expect(result.current.activeSectionStats.charCount).toBe(13);
    expect(result.current.activeSectionStats.readTime).toBe(1);
  });

  it('computes readTime as 0 for empty content', () => {
    setManuscript([makeSection('s1', 'Ch1', '')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    expect(result.current.activeSectionStats).toEqual({ wordCount: 0, charCount: 0, readTime: 0 });
  });
});

// ---------------------------------------------------------------------------
// handleContentChange
// ---------------------------------------------------------------------------
describe('handleContentChange', () => {
  it('dispatches updateManuscriptSection with content change', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleContentChange('s1', 'New content'));
    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateManuscriptSection({ id: 's1', changes: { content: 'New content' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleTitleChange
// ---------------------------------------------------------------------------
describe('handleTitleChange', () => {
  it('dispatches updateManuscriptSection with title change', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleTitleChange('s1', 'New Title'));
    expect(mockDispatch).toHaveBeenCalledWith(
      projectActions.updateManuscriptSection({ id: 's1', changes: { title: 'New Title' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleAddSection
// ---------------------------------------------------------------------------
describe('handleAddSection', () => {
  it('dispatches addManuscriptSection', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleAddSection());
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addManuscriptSection' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleDeleteSection
// ---------------------------------------------------------------------------
describe('handleDeleteSection', () => {
  it('does not dispatch when only one section exists', () => {
    setManuscript([makeSection('s1', 'Ch1', 'only section')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleDeleteSection('s1'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/deleteManuscriptSection' }),
    );
  });

  it('dispatches deleteManuscriptSection when multiple sections exist', () => {
    setManuscript([makeSection('s1', 'Ch1', 'a'), makeSection('s2', 'Ch2', 'b')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleDeleteSection('s2'));
    expect(mockDispatch).toHaveBeenCalledWith(projectActions.deleteManuscriptSection('s2'));
  });

  it('moves active section to a neighbour when the active section is deleted', () => {
    setManuscript([makeSection('s1', 'Ch1', 'a'), makeSection('s2', 'Ch2', 'b')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.setActiveSectionId('s2'));
    act(() => result.current.handleDeleteSection('s2'));
    // Active id should shift to s1 (the previous sibling)
    expect(result.current.activeSectionId).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// handleMoveSection
// ---------------------------------------------------------------------------
describe('handleMoveSection', () => {
  it('dispatches setManuscript with sections swapped when moving up', () => {
    const sections = [makeSection('s1', 'Ch1', 'a'), makeSection('s2', 'Ch2', 'b')];
    setManuscript(sections);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleMoveSection(1, 'up'));

    const call = mockDispatch.mock.calls.find((c) => c[0]?.type === 'project/setManuscript');
    expect(call).toBeDefined();
    const newOrder = (call?.[0] as { payload: StorySection[] }).payload;
    expect(newOrder[0]?.id).toBe('s2');
    expect(newOrder[1]?.id).toBe('s1');
  });

  it('does not dispatch when moving first section up', () => {
    setManuscript([makeSection('s1', 'Ch1', 'a'), makeSection('s2', 'Ch2', 'b')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleMoveSection(0, 'up'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
  });

  it('does not dispatch when moving last section down', () => {
    setManuscript([makeSection('s1', 'Ch1', 'a'), makeSection('s2', 'Ch2', 'b')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleMoveSection(1, 'down'));
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleDragSort
// ---------------------------------------------------------------------------
describe('handleDragSort', () => {
  it('dispatches setManuscript with reordered sections', () => {
    setManuscript([
      makeSection('s1', 'Ch1', 'a'),
      makeSection('s2', 'Ch2', 'b'),
      makeSection('s3', 'Ch3', 'c'),
    ]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));

    // Simulate drag: item at index 0 dragged to index 2
    act(() => {
      result.current.draggedItem.current = 0;
      result.current.dragOverItem.current = 2;
      result.current.handleDragSort();
    });

    const call = mockDispatch.mock.calls.find((c) => c[0]?.type === 'project/setManuscript');
    expect(call).toBeDefined();
    const newOrder = (call?.[0] as { payload: StorySection[] }).payload;
    expect(newOrder[0]?.id).toBe('s2');
    expect(newOrder[2]?.id).toBe('s1');
  });

  it('does nothing when drag refs are null', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.handleDragSort());
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleGenerateLoglines
// ---------------------------------------------------------------------------
describe('handleGenerateLoglines', () => {
  it('opens the logline modal on call', async () => {
    mockUnwrap.mockResolvedValue([]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(result.current.isLoglineModalOpen).toBe(true);
  });

  it('sets loglineSuggestions on fulfilled', async () => {
    mockUnwrap.mockResolvedValue(['Logline A', 'Logline B']);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    await waitFor(() =>
      expect(result.current.loglineSuggestions).toEqual(['Logline A', 'Logline B']),
    );
  });

  it('calls toast.error and closes modal on rejection', async () => {
    mockUnwrap.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(mockToast.error).toHaveBeenCalled();
    expect(result.current.isLoglineModalOpen).toBe(false);
  });

  it('resets isAiLoading to false after rejection', async () => {
    mockUnwrap.mockRejectedValue('fail');
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerateLoglines();
    });
    expect(result.current.isAiLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectLogline
// ---------------------------------------------------------------------------
describe('selectLogline', () => {
  it('dispatches updateLogline and closes modal', () => {
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    act(() => result.current.selectLogline('A warrior rises'));
    expect(mockDispatch).toHaveBeenCalledWith(projectActions.updateLogline('A warrior rises'));
    expect(result.current.isLoglineModalOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleProofread
// ---------------------------------------------------------------------------
describe('handleProofread', () => {
  it('does nothing when active section has no content', async () => {
    setManuscript([makeSection('s1', 'Ch1', '')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleProofread();
    });
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mock-proofread-action' }),
    );
  });

  it('sets proofreadSuggestions on fulfilled dispatch', async () => {
    const suggestions = [{ original: 'teh', suggestion: 'the', explanation: 'typo' }];
    const fulfilledAction = { type: 'project/proofreadText/fulfilled', payload: suggestions };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockProofreadMatch.mockReturnValue(true);

    setManuscript([makeSection('s1', 'Ch1', 'teh cat')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleProofread();
    });

    await waitFor(() => expect(result.current.proofreadSuggestions).toEqual(suggestions));
    expect(result.current.isProofreading).toBe(false);
  });

  it('calls toast.success when no issues found', async () => {
    const fulfilledAction = { type: 'project/proofreadText/fulfilled', payload: [] };
    mockDispatch.mockResolvedValue(fulfilledAction);
    mockProofreadMatch.mockReturnValue(true);

    setManuscript([makeSection('s1', 'Ch1', 'Perfect prose.')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleProofread();
    });

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('calls toast.error on rejected dispatch', async () => {
    const rejectedAction = { type: 'project/proofreadText/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockProofreadMatch.mockReturnValue(false);

    setManuscript([makeSection('s1', 'Ch1', 'Some text')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleProofread();
    });

    expect(mockToast.error).toHaveBeenCalled();
    expect(result.current.isProofreading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleVisualizeScene / sceneImagePreviewUrl
// ---------------------------------------------------------------------------
describe('handleVisualizeScene', () => {
  it('sets sceneImagePreviewUrl on fulfilled', async () => {
    mockUnwrap.mockResolvedValue({ imageKey: 'scene-s1', dataUrl: 'data:image/png;base64,abc' });
    setManuscript([makeSection('s1', 'Ch1', 'A scene with action')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleVisualizeScene();
    });
    expect(result.current.sceneImagePreviewUrl).toBe('data:image/png;base64,abc');
  });

  it('calls toast.error on rejection', async () => {
    mockUnwrap.mockRejectedValue(new Error('Image gen failed'));
    setManuscript([makeSection('s1', 'Ch1', 'Scene content')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleVisualizeScene();
    });
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('does nothing when active section has no content', async () => {
    setManuscript([makeSection('s1', 'Ch1', '')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));
    await act(async () => {
      await result.current.handleVisualizeScene();
    });
    expect(mockUnwrap).not.toHaveBeenCalled();
  });

  it('resets sceneImagePreviewUrl when activeSectionId changes', async () => {
    mockUnwrap.mockResolvedValue({ imageKey: 'scene-s1', dataUrl: 'data:image/png;base64,abc' });
    setManuscript([makeSection('s1', 'Ch1', 'Scene one'), makeSection('s2', 'Ch2', 'Scene two')]);
    const { result } = renderHook(() => useManuscriptView({ onNavigate }));

    await act(async () => {
      await result.current.handleVisualizeScene();
    });
    expect(result.current.sceneImagePreviewUrl).toBe('data:image/png;base64,abc');

    // Switch section — preview should clear
    act(() => result.current.setActiveSectionId('s2'));
    expect(result.current.sceneImagePreviewUrl).toBeNull();
  });
});
