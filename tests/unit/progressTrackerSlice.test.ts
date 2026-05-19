import { describe, expect, it } from 'vitest';
import progressTrackerReducer, {
  computeStreak,
  type ProgressTrackerState,
  progressTrackerActions,
} from '../../features/progressTracker/progressTrackerSlice';

const defaultState: ProgressTrackerState = {
  dailyGoalWords: 500,
  weeklyGoalWords: 2500,
  activeSession: null,
  streakDays: 0,
  longestStreak: 0,
  totalWordsAllTime: 0,
};

describe('progressTrackerSlice', () => {
  it('returns default state', () => {
    const state = progressTrackerReducer(undefined, { type: '@@INIT' });
    expect(state.dailyGoalWords).toBe(500);
    expect(state.activeSession).toBeNull();
  });

  it('startSession sets activeSession', () => {
    const state = progressTrackerReducer(defaultState, progressTrackerActions.startSession(1000));
    expect(state.activeSession).not.toBeNull();
    expect(state.activeSession?.startWordCount).toBe(1000);
  });

  it('endSession clears activeSession and updates totalWordsAllTime', () => {
    const withSession: ProgressTrackerState = {
      ...defaultState,
      activeSession: { startedAt: Date.now(), startWordCount: 500 },
    };
    const state = progressTrackerReducer(
      withSession,
      progressTrackerActions.endSession({ currentWordCount: 700 }),
    );
    expect(state.activeSession).toBeNull();
    expect(state.totalWordsAllTime).toBe(200);
  });

  it('endSession does nothing if no active session', () => {
    const state = progressTrackerReducer(
      defaultState,
      progressTrackerActions.endSession({ currentWordCount: 700 }),
    );
    expect(state.activeSession).toBeNull();
    expect(state.totalWordsAllTime).toBe(0);
  });

  it('endSession does not go negative', () => {
    const withSession: ProgressTrackerState = {
      ...defaultState,
      activeSession: { startedAt: Date.now(), startWordCount: 1000 },
    };
    const state = progressTrackerReducer(
      withSession,
      progressTrackerActions.endSession({ currentWordCount: 800 }),
    );
    expect(state.totalWordsAllTime).toBe(0);
  });

  it('setDailyGoal updates goal', () => {
    const state = progressTrackerReducer(defaultState, progressTrackerActions.setDailyGoal(750));
    expect(state.dailyGoalWords).toBe(750);
  });

  it('setDailyGoal clamps to minimum 1', () => {
    const state = progressTrackerReducer(defaultState, progressTrackerActions.setDailyGoal(0));
    expect(state.dailyGoalWords).toBe(1);
  });

  it('setWeeklyGoal updates goal', () => {
    const state = progressTrackerReducer(defaultState, progressTrackerActions.setWeeklyGoal(3000));
    expect(state.weeklyGoalWords).toBe(3000);
  });

  it('syncStreak updates streak fields', () => {
    const state = progressTrackerReducer(
      defaultState,
      progressTrackerActions.syncStreak({ current: 5, longest: 10 }),
    );
    expect(state.streakDays).toBe(5);
    expect(state.longestStreak).toBe(10);
  });
});

describe('computeStreak', () => {
  it('returns zero for empty history', () => {
    expect(computeStreak([])).toEqual({ current: 0, longest: 0 });
  });

  it('returns zero when no days have words', () => {
    const history = [
      { date: '2026-01-01', words: 0 },
      { date: '2026-01-02', words: 0 },
    ];
    expect(computeStreak(history)).toEqual({ current: 0, longest: 0 });
  });

  it('computes longest streak across gap', () => {
    const history = [
      { date: '2026-01-01', words: 100 },
      { date: '2026-01-02', words: 100 },
      { date: '2026-01-03', words: 100 },
      { date: '2026-01-05', words: 100 }, // gap on Jan 4
      { date: '2026-01-06', words: 100 },
    ];
    const result = computeStreak(history);
    expect(result.longest).toBe(3);
  });

  it('handles single day with words', () => {
    const today = new Date().toISOString().slice(0, 10);
    const history = [{ date: today, words: 50 }];
    const result = computeStreak(history);
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });
});
