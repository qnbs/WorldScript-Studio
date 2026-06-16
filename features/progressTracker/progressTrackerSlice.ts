// QNBS-v3: Progress tracker state is ephemeral session data + user goals.
//          Persisted to localStorage so goals survive refresh but session resets cleanly.
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface WritingSessionLive {
  startedAt: number; // Date.now()
  startWordCount: number; // project total words at session start
}

export interface StreakResult {
  current: number;
  longest: number;
}

export interface ProgressTrackerState {
  dailyGoalWords: number;
  weeklyGoalWords: number;
  activeSession: WritingSessionLive | null;
  streakDays: number;
  longestStreak: number;
  totalWordsAllTime: number;
}

const STORAGE_KEY = 'worldscript-progress-tracker';

const defaultState: ProgressTrackerState = {
  dailyGoalWords: 500,
  weeklyGoalWords: 2500,
  activeSession: null,
  streakDays: 0,
  longestStreak: 0,
  totalWordsAllTime: 0,
};

const loadState = (): ProgressTrackerState => {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<ProgressTrackerState>;
    return {
      ...defaultState,
      ...parsed,
      // Always reset active session on load — session ends when browser closes
      activeSession: null,
    };
  } catch {
    return defaultState;
  }
};

/**
 * Computes current and longest writing streaks from a history of daily word counts.
 * A streak is a consecutive series of days (UTC date strings) with words > 0.
 */
export function computeStreak(writingHistory: { date: string; words: number }[]): StreakResult {
  if (writingHistory.length === 0) return { current: 0, longest: 0 };

  // Collect dates with actual writing activity
  const datesWithWords = new Set(writingHistory.filter((d) => d.words > 0).map((d) => d.date));

  if (datesWithWords.size === 0) return { current: 0, longest: 0 };

  // Sort dates ascending
  const sortedDates = [...datesWithWords].sort();

  // Compute longest streak
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1]!;
    const curr = sortedDates[i]!;
    const prevDate = new Date(prev);
    const currDate = new Date(curr);
    const diffMs = currDate.getTime() - prevDate.getTime();
    const diffDays = Math.round(diffMs / 86_400_000);
    if (diffDays === 1) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Compute current streak (from today backward)
  const todayStr = new Date().toISOString().slice(0, 10);
  let current = 0;
  let checkDate = new Date(todayStr);
  while (true) {
    const ds = checkDate.toISOString().slice(0, 10);
    if (datesWithWords.has(ds)) {
      current++;
      checkDate = new Date(checkDate.getTime() - 86_400_000);
    } else {
      break;
    }
  }

  return { current, longest };
}

const progressTrackerSlice = createSlice({
  name: 'progressTracker',
  initialState: loadState,
  reducers: {
    startSession(state, action: PayloadAction<number>) {
      state.activeSession = {
        startedAt: Date.now(),
        startWordCount: action.payload,
      };
    },
    endSession(state, action: PayloadAction<{ currentWordCount: number }>) {
      if (!state.activeSession) return;
      const wordsWritten = Math.max(
        0,
        action.payload.currentWordCount - state.activeSession.startWordCount,
      );
      state.totalWordsAllTime += wordsWritten;
      state.activeSession = null;
    },
    setDailyGoal(state, action: PayloadAction<number>) {
      state.dailyGoalWords = Math.max(1, action.payload);
    },
    setWeeklyGoal(state, action: PayloadAction<number>) {
      state.weeklyGoalWords = Math.max(1, action.payload);
    },
    syncStreak(state, action: PayloadAction<{ current: number; longest: number }>) {
      state.streakDays = action.payload.current;
      state.longestStreak = action.payload.longest;
    },
  },
});

export const progressTrackerActions = progressTrackerSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectProgressTracker = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker;

export const selectActiveSession = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.activeSession;

export const selectDailyGoal = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.dailyGoalWords;

export const selectWeeklyGoal = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.weeklyGoalWords;

export const selectStreakDays = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.streakDays;

export const selectLongestStreak = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.longestStreak;

export const selectTotalWordsAllTime = (state: { progressTracker: ProgressTrackerState }) =>
  state.progressTracker.totalWordsAllTime;

// ── Persistence middleware ────────────────────────────────────────────────────
import type { Middleware } from '@reduxjs/toolkit';

export const progressTrackerPersistenceMiddleware: Middleware<unknown, unknown> =
  (storeAPI) => (next) => (action) => {
    const result = next(action);
    const actionType = (action as { type?: string }).type;
    if (typeof actionType === 'string' && actionType.startsWith('progressTracker/')) {
      try {
        const state = storeAPI.getState() as { progressTracker: ProgressTrackerState };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progressTracker));
      } catch {
        // localStorage may be unavailable
      }
    }
    return result;
  };

export default progressTrackerSlice.reducer;
