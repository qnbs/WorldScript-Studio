import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import type { ProgressTrackerContextType } from '../contexts/ProgressTrackerContext';
import {
  computeStreak,
  progressTrackerActions,
  selectProgressTracker,
} from '../features/progressTracker/progressTrackerSlice';
import { selectTotalWordCount, selectWritingHistory } from '../features/project/projectSelectors';
import { useTranslation } from './useTranslation';

export function useProgressTrackerView(): ProgressTrackerContextType {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const tracker = useAppSelector(selectProgressTracker);
  const writingHistory = useAppSelector(selectWritingHistory);
  const totalWordCount = useAppSelector(selectTotalWordCount);

  // Live session timer
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSessionActive = tracker.activeSession !== null;

  useEffect(() => {
    if (isSessionActive) {
      timerRef.current = setInterval(() => {
        setSessionElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setSessionElapsed(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isSessionActive]);

  // Words written this session
  const sessionWordsDelta = isSessionActive
    ? Math.max(0, totalWordCount - (tracker.activeSession?.startWordCount ?? totalWordCount))
    : 0;

  // Words today from writingHistory
  const todayStr = new Date().toISOString().slice(0, 10);
  const wordsToday = writingHistory.find((h) => h.date === todayStr)?.words ?? 0;

  // Words this week
  const wordsThisWeek = (() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    return writingHistory
      .filter((h) => h.date >= weekStartStr)
      .reduce((sum, h) => sum + h.words, 0);
  })();

  // Streak sync
  useEffect(() => {
    const { current, longest } = computeStreak(writingHistory);
    if (current !== tracker.streakDays || longest !== tracker.longestStreak) {
      dispatch(progressTrackerActions.syncStreak({ current, longest }));
    }
  }, [writingHistory, tracker.streakDays, tracker.longestStreak, dispatch]);

  const setDailyGoal = useCallback(
    (n: number) => dispatch(progressTrackerActions.setDailyGoal(n)),
    [dispatch],
  );

  const setWeeklyGoal = useCallback(
    (n: number) => dispatch(progressTrackerActions.setWeeklyGoal(n)),
    [dispatch],
  );

  const handleStartSession = useCallback(() => {
    dispatch(progressTrackerActions.startSession(totalWordCount));
  }, [dispatch, totalWordCount]);

  const handleEndSession = useCallback(() => {
    dispatch(progressTrackerActions.endSession({ currentWordCount: totalWordCount }));
  }, [dispatch, totalWordCount]);

  return {
    t,
    dailyGoalWords: tracker.dailyGoalWords,
    weeklyGoalWords: tracker.weeklyGoalWords,
    streakDays: tracker.streakDays,
    longestStreak: tracker.longestStreak,
    totalWordsAllTime: tracker.totalWordsAllTime,
    wordsToday,
    wordsThisWeek,
    isSessionActive,
    sessionElapsed,
    sessionWordsDelta,
    writingHistory,
    setDailyGoal,
    setWeeklyGoal,
    handleStartSession,
    handleEndSession,
  };
}
