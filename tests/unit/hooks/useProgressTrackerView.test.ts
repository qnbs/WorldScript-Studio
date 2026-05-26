/**
 * Tests for hooks/useProgressTrackerView.ts
 * QNBS-v3: Covers session timer, word delta, streak sync, goal dispatch, today/week aggregation.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();

const baseTracker = {
  activeSession: null as { startWordCount: number; startedAt: string } | null,
  dailyGoalWords: 500,
  weeklyGoalWords: 3000,
  streakDays: 0,
  longestStreak: 0,
  totalWordsAllTime: 0,
};

let mockTracker = { ...baseTracker };
let mockWritingHistory: { date: string; words: number }[] = [];
let mockTotalWordCount = 0;

vi.mock('../../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      progressTracker: mockTracker,
      project: {
        present: {
          data: {
            writingHistory: mockWritingHistory,
            manuscript: [],
          },
        },
      },
    }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../features/progressTracker/progressTrackerSlice', () => ({
  progressTrackerActions: {
    startSession: vi.fn((wc) => ({ type: 'progressTracker/startSession', payload: wc })),
    endSession: vi.fn((p) => ({ type: 'progressTracker/endSession', payload: p })),
    setDailyGoal: vi.fn((n) => ({ type: 'progressTracker/setDailyGoal', payload: n })),
    setWeeklyGoal: vi.fn((n) => ({ type: 'progressTracker/setWeeklyGoal', payload: n })),
    syncStreak: vi.fn((p) => ({ type: 'progressTracker/syncStreak', payload: p })),
  },
  computeStreak: vi.fn(() => ({ current: 0, longest: 0 })),
  selectProgressTracker: (s: { progressTracker: typeof baseTracker }) => s.progressTracker,
}));

vi.mock('../../../features/project/projectSelectors', () => ({
  selectTotalWordCount: () => mockTotalWordCount,
  selectWritingHistory: (s: {
    project: { present: { data: { writingHistory: { date: string; words: number }[] } } };
  }) => s.project.present.data.writingHistory,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  computeStreak,
  progressTrackerActions,
} from '../../../features/progressTracker/progressTrackerSlice';
import { useProgressTrackerView } from '../../../hooks/useProgressTrackerView';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProgressTrackerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockTracker = { ...baseTracker };
    mockWritingHistory = [];
    mockTotalWordCount = 0;
    vi.mocked(computeStreak).mockReturnValue({ current: 0, longest: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.isSessionActive).toBe(false);
    expect(result.current.sessionElapsed).toBe(0);
    expect(result.current.dailyGoalWords).toBe(500);
    expect(result.current.weeklyGoalWords).toBe(3000);
  });

  it('dispatches startSession when handleStartSession is called', () => {
    mockTotalWordCount = 1200;
    const { result } = renderHook(() => useProgressTrackerView());

    act(() => {
      result.current.handleStartSession();
    });

    expect(mockDispatch).toHaveBeenCalled();
    expect(progressTrackerActions.startSession).toHaveBeenCalledWith(1200);
  });

  it('dispatches endSession when handleEndSession is called', () => {
    mockTotalWordCount = 1500;
    const { result } = renderHook(() => useProgressTrackerView());

    act(() => {
      result.current.handleEndSession();
    });

    expect(progressTrackerActions.endSession).toHaveBeenCalledWith({ currentWordCount: 1500 });
  });

  it('dispatches setDailyGoal', () => {
    const { result } = renderHook(() => useProgressTrackerView());
    act(() => {
      result.current.setDailyGoal(800);
    });
    expect(progressTrackerActions.setDailyGoal).toHaveBeenCalledWith(800);
  });

  it('dispatches setWeeklyGoal', () => {
    const { result } = renderHook(() => useProgressTrackerView());
    act(() => {
      result.current.setWeeklyGoal(5000);
    });
    expect(progressTrackerActions.setWeeklyGoal).toHaveBeenCalledWith(5000);
  });

  it('computes wordsToday from writing history', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    mockWritingHistory = [{ date: todayStr, words: 350 }];
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.wordsToday).toBe(350);
  });

  it('returns 0 for wordsToday when no history entry for today', () => {
    mockWritingHistory = [{ date: '2020-01-01', words: 500 }];
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.wordsToday).toBe(0);
  });

  it('computes wordsThisWeek from history within the current week', () => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const todayStr = now.toISOString().slice(0, 10);

    mockWritingHistory = [
      { date: weekStartStr, words: 200 },
      { date: todayStr, words: 300 },
      { date: '2000-01-01', words: 999 }, // outside week
    ];
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.wordsThisWeek).toBe(500);
  });

  it('increments sessionElapsed every second when session is active', () => {
    mockTracker = {
      ...baseTracker,
      activeSession: { startWordCount: 1000, startedAt: new Date().toISOString() },
    };
    const { result } = renderHook(() => useProgressTrackerView());

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.sessionElapsed).toBe(3);
  });

  it('resets sessionElapsed to 0 when session ends', () => {
    mockTracker = {
      ...baseTracker,
      activeSession: { startWordCount: 1000, startedAt: new Date().toISOString() },
    };
    const { result, rerender } = renderHook(() => useProgressTrackerView());

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.sessionElapsed).toBe(2);

    // End session
    mockTracker = { ...baseTracker, activeSession: null };
    rerender();

    expect(result.current.sessionElapsed).toBe(0);
  });

  it('computes sessionWordsDelta correctly', () => {
    mockTracker = {
      ...baseTracker,
      activeSession: { startWordCount: 1000, startedAt: new Date().toISOString() },
    };
    mockTotalWordCount = 1150;
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.sessionWordsDelta).toBe(150);
  });

  it('clamps sessionWordsDelta to 0 (never negative)', () => {
    mockTracker = {
      ...baseTracker,
      activeSession: { startWordCount: 2000, startedAt: new Date().toISOString() },
    };
    mockTotalWordCount = 1800; // less than startWordCount
    const { result } = renderHook(() => useProgressTrackerView());
    expect(result.current.sessionWordsDelta).toBe(0);
  });

  it('dispatches syncStreak when computeStreak returns different values', () => {
    vi.mocked(computeStreak).mockReturnValue({ current: 5, longest: 10 });
    mockTracker = { ...baseTracker, streakDays: 0, longestStreak: 0 };
    renderHook(() => useProgressTrackerView());
    expect(progressTrackerActions.syncStreak).toHaveBeenCalledWith({ current: 5, longest: 10 });
  });
});
