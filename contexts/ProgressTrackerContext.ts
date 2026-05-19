import { createContext, useContext } from 'react';

export interface ProgressTrackerContextType {
  t: (key: string, replacements?: Record<string, string>) => string;
  dailyGoalWords: number;
  weeklyGoalWords: number;
  streakDays: number;
  longestStreak: number;
  totalWordsAllTime: number;
  wordsToday: number;
  wordsThisWeek: number;
  isSessionActive: boolean;
  sessionElapsed: number; // seconds
  sessionWordsDelta: number;
  writingHistory: { date: string; words: number }[];
  setDailyGoal: (n: number) => void;
  setWeeklyGoal: (n: number) => void;
  handleStartSession: () => void;
  handleEndSession: () => void;
}

export const ProgressTrackerContext = createContext<ProgressTrackerContextType | null>(null);

export const useProgressTrackerContext = () => {
  const ctx = useContext(ProgressTrackerContext);
  if (!ctx)
    throw new Error(
      'useProgressTrackerContext must be used within ProgressTrackerContext.Provider',
    );
  return ctx;
};
