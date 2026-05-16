import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutlineGenerator } from '../../../hooks/useOutlineGenerator';
import type { OutlineSection, StorySection } from '../../../types';

// ---------------------------------------------------------------------------
// vi.hoisted — match mocks referenced inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockGenerateMatch, mockRegenerateMatch } = vi.hoisted(() => ({
  mockGenerateMatch: vi.fn((_: unknown) => true),
  mockRegenerateMatch: vi.fn((_: unknown) => true),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
let mockExistingOutline: OutlineSection[] = [];
let mockExistingManuscript: StorySection[] = [];

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (
    selector: (s: {
      existingOutline: OutlineSection[];
      existingManuscript: StorySection[];
    }) => unknown,
  ) =>
    selector({ existingOutline: mockExistingOutline, existingManuscript: mockExistingManuscript }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('../../../components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectOutline: (state: { existingOutline: OutlineSection[] }) => state.existingOutline,
  selectManuscript: (state: { existingManuscript: StorySection[] }) => state.existingManuscript,
}));

vi.mock('../../../features/project/thunks/outlineThunks', () => {
  const generateThunk = vi.fn(() => ({ type: 'mock-generate-action' }));
  (generateThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockGenerateMatch(action),
  };

  const regenerateThunk = vi.fn(() => ({ type: 'mock-regenerate-action' }));
  (regenerateThunk as unknown as { fulfilled: { match: (a: unknown) => unknown } }).fulfilled = {
    match: (action: unknown) => mockRegenerateMatch(action),
  };

  return {
    generateOutlineThunk: generateThunk,
    regenerateOutlineSectionThunk: regenerateThunk,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutlineSection(id: string, title = 'Chapter'): OutlineSection {
  return { id, title, description: 'Some description' };
}

const onNavigate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatch.mockResolvedValue({ type: 'mock-action' });
  mockExistingOutline = [];
  mockExistingManuscript = [{ id: 's1', title: 'Ch1', content: '' }];
  mockGenerateMatch.mockReturnValue(true);
  mockRegenerateMatch.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// handleGenerate / generate
// ---------------------------------------------------------------------------
describe('generate', () => {
  it('sets outline on fulfilled', async () => {
    const sections = [makeOutlineSection('g1', 'Act 1'), makeOutlineSection('g2', 'Act 2')];
    const fulfilledAction = { type: 'project/generateOutline/fulfilled', payload: sections };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerate();
    });

    await waitFor(() => expect(result.current.outline.length).toBe(2));
    expect(result.current.outline[0]?.id).toBe('g1');
  });

  it('calls toast.success on fulfilled', async () => {
    const fulfilledAction = {
      type: 'project/generateOutline/fulfilled',
      payload: [makeOutlineSection('g1')],
    };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(mockToast.success).toHaveBeenCalled();
  });

  it('sets error and calls toast.error on rejected', async () => {
    const rejectedAction = { type: 'project/generateOutline/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockGenerateMatch.mockReturnValue(false);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(result.current.error).not.toBeNull();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isLoading to false after completion', async () => {
    const fulfilledAction = {
      type: 'project/generateOutline/fulfilled',
      payload: [],
    };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(result.current.isLoading).toBe(false);
  });
});

describe('handleGenerate with existing outline', () => {
  it('opens confirm modal when outline is not empty', () => {
    mockExistingOutline = [makeOutlineSection('o1')];

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.handleGenerate());

    expect(result.current.confirmModal?.type).toBe('overwrite');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('calls generate directly when outline is empty', async () => {
    mockExistingOutline = [];
    const fulfilledAction = { type: 'fulfilled', payload: [] };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleGenerate();
    });

    expect(mockDispatch).toHaveBeenCalled();
    expect(result.current.confirmModal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleRegenerate
// ---------------------------------------------------------------------------
describe('handleRegenerate', () => {
  it('does nothing when index is out of bounds', async () => {
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleRegenerate(5);
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('updates the section on fulfilled', async () => {
    mockExistingOutline = [makeOutlineSection('s1', 'Old Title'), makeOutlineSection('s2')];
    const fulfilledAction = {
      type: 'project/regenerateOutlineSection/fulfilled',
      payload: { index: 0, newSection: { title: 'New Title', description: 'Updated' } },
    };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleRegenerate(0);
    });

    await waitFor(() => expect(result.current.outline[0]?.title).toBe('New Title'));
  });

  it('calls toast.error on rejected', async () => {
    mockExistingOutline = [makeOutlineSection('s1')];
    const rejectedAction = { type: 'project/regenerateOutlineSection/rejected' };
    mockDispatch.mockResolvedValue(rejectedAction);
    mockRegenerateMatch.mockReturnValue(false);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleRegenerate(0);
    });

    expect(mockToast.error).toHaveBeenCalled();
  });

  it('resets isRegenerating to null after completion', async () => {
    mockExistingOutline = [makeOutlineSection('s1')];
    const fulfilledAction = {
      type: 'fulfilled',
      payload: { index: 0, newSection: { title: 'New' } },
    };
    mockDispatch.mockResolvedValue(fulfilledAction);

    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    await act(async () => {
      await result.current.handleRegenerate(0);
    });

    expect(result.current.isRegenerating).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// handleDragSort
// ---------------------------------------------------------------------------
describe('handleDragSort', () => {
  it('does nothing when drag refs are null', () => {
    mockExistingOutline = [makeOutlineSection('s1'), makeOutlineSection('s2')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    const originalOutline = result.current.outline;

    act(() => result.current.handleDragSort());

    expect(result.current.outline).toEqual(originalOutline);
  });

  it('reorders outline sections', () => {
    mockExistingOutline = [
      makeOutlineSection('s1', 'A'),
      makeOutlineSection('s2', 'B'),
      makeOutlineSection('s3', 'C'),
    ];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));

    act(() => {
      result.current.draggedItem.current = 0;
      result.current.dragOverItem.current = 2;
      result.current.handleDragSort();
    });

    expect(result.current.outline[0]?.id).toBe('s2');
    expect(result.current.outline[2]?.id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// handleMove
// ---------------------------------------------------------------------------
describe('handleMove', () => {
  it('swaps section upward', () => {
    mockExistingOutline = [makeOutlineSection('s1'), makeOutlineSection('s2')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.handleMove(1, 'up'));
    expect(result.current.outline[0]?.id).toBe('s2');
    expect(result.current.outline[1]?.id).toBe('s1');
  });

  it('does nothing when moving first section up', () => {
    mockExistingOutline = [makeOutlineSection('s1'), makeOutlineSection('s2')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.handleMove(0, 'up'));
    expect(result.current.outline[0]?.id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// updateSection / addSection / deleteSection
// ---------------------------------------------------------------------------
describe('updateSection', () => {
  it('updates a section by id', () => {
    mockExistingOutline = [makeOutlineSection('s1', 'Original')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.updateSection('s1', { title: 'Updated' }));
    expect(result.current.outline[0]?.title).toBe('Updated');
  });
});

describe('addSection', () => {
  it('inserts a new section after the given index', () => {
    mockExistingOutline = [makeOutlineSection('s1'), makeOutlineSection('s2')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.addSection(0));
    expect(result.current.outline).toHaveLength(3);
    expect(result.current.outline[1]?.id).toMatch(/^custom-/);
  });
});

describe('deleteSection', () => {
  it('removes the section with the given id', () => {
    mockExistingOutline = [makeOutlineSection('s1'), makeOutlineSection('s2')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));
    act(() => result.current.deleteSection('s1'));
    expect(result.current.outline).toHaveLength(1);
    expect(result.current.outline[0]?.id).toBe('s2');
  });
});

// ---------------------------------------------------------------------------
// handleApplyOutline / apply
// ---------------------------------------------------------------------------
describe('handleApplyOutline', () => {
  it('applies directly when manuscript is a single empty section', () => {
    mockExistingManuscript = [{ id: 's1', title: 'Untitled', content: '' }];
    mockExistingOutline = [makeOutlineSection('o1', 'Act 1')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));

    act(() => result.current.handleApplyOutline());

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setOutline' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
    expect(onNavigate).toHaveBeenCalledWith('manuscript');
  });

  it('opens confirm modal when manuscript has content', () => {
    mockExistingManuscript = [{ id: 's1', title: 'Ch1', content: 'Existing content' }];
    mockExistingOutline = [makeOutlineSection('o1')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));

    act(() => result.current.handleApplyOutline());

    expect(result.current.confirmModal?.type).toBe('apply');
    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
  });

  it('dispatches setOutline + setManuscript when confirmed via modal', () => {
    mockExistingManuscript = [{ id: 's1', title: 'Ch1', content: 'Has content' }];
    mockExistingOutline = [makeOutlineSection('o1', 'Act 1')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));

    act(() => result.current.handleApplyOutline());
    expect(result.current.confirmModal?.type).toBe('apply');

    // Simulate user confirming
    act(() => result.current.confirmModal?.onConfirm());

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setOutline' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/setManuscript' }),
    );
    expect(onNavigate).toHaveBeenCalledWith('manuscript');
  });

  it('calls toast.success after applying', () => {
    mockExistingManuscript = [{ id: 's1', title: 'Untitled', content: '' }];
    mockExistingOutline = [makeOutlineSection('o1')];
    const { result } = renderHook(() => useOutlineGenerator({ onNavigate }));

    act(() => result.current.handleApplyOutline());

    expect(mockToast.success).toHaveBeenCalled();
  });
});
