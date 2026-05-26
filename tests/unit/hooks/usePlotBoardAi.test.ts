/**
 * Tests for hooks/usePlotBoardAi.ts
 * QNBS-v3: Covers beat suggestion flow, loading state, error handling, clearBeats.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockProjectData = { id: 'proj-1', title: 'My Novel' };

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      project: { present: { data: mockProjectData } },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectProjectData: (s: { project: { present: { data: typeof mockProjectData } } }) =>
    s.project.present.data,
}));

const mockSuggestNextBeatThunk = vi.fn();
vi.mock('../../../features/project/thunks/plotBoardAiThunks', () => ({
  suggestNextBeatThunk: (p: unknown) => {
    mockSuggestNextBeatThunk(p);
    return { type: 'plotBoardAi/suggestNextBeat', payload: p };
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { usePlotBoardAi } from '../../../hooks/usePlotBoardAi';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const BEATS = [
  { title: 'The Call', description: 'Hero receives call to action', genre: 'adventure' },
  { title: 'Refusal', description: 'Hero hesitates', genre: 'adventure' },
];

describe('usePlotBoardAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectData = { id: 'proj-1', title: 'My Novel' };
  });

  it('initializes with empty beats, not loading, no error', () => {
    const { result } = renderHook(() => usePlotBoardAi('A hero story', []));
    expect(result.current.beats).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.ragChunkCount).toBe(0);
  });

  it('exposes a suggestNextBeat function and a clearBeats function', () => {
    const { result } = renderHook(() => usePlotBoardAi('A hero story', []));
    expect(typeof result.current.suggestNextBeat).toBe('function');
    expect(typeof result.current.clearBeats).toBe('function');
  });

  it('does not dispatch when plotSummary is empty', async () => {
    const { result } = renderHook(() => usePlotBoardAi('  ', []));
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch when project is null', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: test cast
    mockProjectData = null as any;
    const { result } = renderHook(() => usePlotBoardAi('Some summary', []));
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('sets beats and ragChunkCount on successful dispatch', async () => {
    // QNBS-v3: dispatch(thunk) returns a thenable with .unwrap() — use mockReturnValueOnce, not mockResolvedValueOnce
    mockDispatch.mockReturnValueOnce({
      unwrap: () => Promise.resolve({ beats: BEATS, ragChunkCount: 5 }),
    });
    const { result } = renderHook(() => usePlotBoardAi('A hero story', ['sec-1']));
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(result.current.beats).toHaveLength(2);
    expect(result.current.ragChunkCount).toBe(5);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error and clears beats on failed dispatch', async () => {
    mockDispatch.mockReturnValueOnce({
      unwrap: () => Promise.reject(new Error('AI quota exceeded')),
    });
    const { result } = renderHook(() => usePlotBoardAi('A hero story', []));
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(result.current.error).toBe('AI quota exceeded');
    expect(result.current.beats).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('clears beats via clearBeats()', async () => {
    mockDispatch.mockReturnValueOnce({
      unwrap: () => Promise.resolve({ beats: BEATS, ragChunkCount: 2 }),
    });
    const { result } = renderHook(() => usePlotBoardAi('A hero story', []));
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(result.current.beats).toHaveLength(2);
    act(() => result.current.clearBeats());
    expect(result.current.beats).toHaveLength(0);
  });

  it('passes plotSummary and selectedSectionIds to the thunk', async () => {
    mockDispatch.mockReturnValueOnce({
      unwrap: () => Promise.resolve({ beats: [], ragChunkCount: 0 }),
    });
    const { result } = renderHook(() =>
      usePlotBoardAi('Dragon rises in the east', ['sec-1', 'sec-2']),
    );
    await act(async () => {
      await result.current.suggestNextBeat();
    });
    expect(mockSuggestNextBeatThunk).toHaveBeenCalledWith(
      expect.objectContaining({
        plotSummary: 'Dragon rises in the east',
        selectedSectionIds: ['sec-1', 'sec-2'],
      }),
    );
  });
});
