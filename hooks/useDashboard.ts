import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useToast } from '../components/ui/Toast';
import { computeStreak } from '../features/progressTracker/progressTrackerSlice';
import {
  captureActiveProjectIdentity,
  getProjectTargetIdentity,
  identityUnchanged,
} from '../features/project/projectIdentity';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { generateLoglineSuggestionsThunk } from '../features/project/thunks/writingThunks';
import { sampleManuscriptPlainText } from '../services/manuscriptMetricsSampling';
import { computeReadabilitySnapshot } from '../services/readabilityFlesch';
import { evaluateSceneTimeline } from '../services/sceneTimelineRules';
import type { View } from '../types';
import { useTranslation } from './useTranslation';

export interface UseDashboardProps {
  onNavigate: (view: View) => void;
}

/** Words-per-minute used for the manuscript reading-time estimate (silent-reading average). */
const READING_WPM = 238;

/** Greeting i18n key keyed off the local hour — drives the personalized header. */
function greetingKeyForHour(hour: number): string {
  if (hour < 5) return 'dashboard.header.greetingNight';
  if (hour < 12) return 'dashboard.header.greetingMorning';
  if (hour < 18) return 'dashboard.header.greetingAfternoon';
  if (hour < 22) return 'dashboard.header.greetingEvening';
  return 'dashboard.header.greetingNight';
}

export const useDashboard = ({ onNavigate }: UseDashboardProps) => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const projectIdentity = useAppSelector((state) =>
    getProjectTargetIdentity(state.project.present),
  );
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  // QNBS-v3: null-safe inline selectors — the slice selectors index state.progressTracker directly,
  // which throws under the dashboard hook's empty-state test harness. Defaults mirror the slice.
  const dailyGoalWords = useAppSelector((s) => s.progressTracker?.dailyGoalWords ?? 500);
  const weeklyGoalWords = useAppSelector((s) => s.progressTracker?.weeklyGoalWords ?? 2500);
  const toast = useToast();

  // Logline Generation State
  const [isLoglineModalOpen, setIsLoglineModalOpen] = useState(false);
  const [loglineSuggestions, setLoglineSuggestions] = useState<string[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const loglineRequestRef = useRef(0);
  // QNBS-v3 (#713): frozen at successful-generation time (not resynced on every render) so selectLogline() can independently detect that the live identity has since diverged from the one that produced these suggestions -- mirrors useManuscriptView.ts's dashboard-equivalent guard.
  const loglineGeneratedForIdentityRef = useRef<string | null>(null);
  // QNBS-v3 (#713): genuinely read in the invalidation effect below (compare-against-previous-value), not merely a trigger-only dependency, so no lint suppression is needed for it.
  const prevLoglineIdentityRef = useRef(projectIdentity);

  // QNBS-v3 (#713): Dashboard runs its own independent logline-generation flow (not useManuscriptView's), so it needs the identical project-incarnation guard -- a project switch (e.g. via BackupQuickActionsCard's import, which keeps Dashboard mounted) must invalidate any in-flight or already-generated suggestions.
  useEffect(() => {
    if (prevLoglineIdentityRef.current === projectIdentity) return;
    prevLoglineIdentityRef.current = projectIdentity;
    loglineRequestRef.current += 1;
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(false);
    setIsAiLoading(false);
  }, [projectIdentity]);

  // Goals State
  const [isGoalModalOpen, setIsGoalModalOpen] = useState(false);
  const [goalWordCount, setGoalWordCount] = useState(project.projectGoals?.totalWordCount || 50000);
  const [goalTargetDate, setGoalTargetDate] = useState(project.projectGoals?.targetDate || '');

  // Calculations
  const wordCount = useMemo(() => {
    return project.manuscript.reduce((acc, section) => {
      const words = section.content?.match(/\S+/g) || [];
      return acc + words.length;
    }, 0);
  }, [project.manuscript]);

  const wordCountProgress = useMemo(
    () =>
      project.projectGoals?.totalWordCount
        ? (wordCount / project.projectGoals.totalWordCount) * 100
        : 0,
    [wordCount, project.projectGoals?.totalWordCount],
  );

  const readabilitySample = useMemo(
    () => sampleManuscriptPlainText(project.manuscript),
    [project.manuscript],
  );

  // QNBS-v3: Pass locale so the correct language-specific heuristic (DE/Amstad, FR/Kandel-Moles…) is used.
  const readability = useMemo(
    () => computeReadabilitySnapshot(readabilitySample, language),
    [readabilitySample, language],
  );

  const sceneTimelineHints = useMemo(
    () => evaluateSceneTimeline(project.manuscript),
    [project.manuscript],
  );

  const daysLeft = useMemo(() => {
    if (!project.projectGoals?.targetDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(project.projectGoals.targetDate);
    const targetLocal = new Date(targetDate.getTime() + targetDate.getTimezoneOffset() * 60000);
    targetLocal.setHours(0, 0, 0, 0);
    const diffTime = targetLocal.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [project.projectGoals?.targetDate]);

  // QNBS-v3: writingHistory read off the project object (not a dedicated selector) so the dashboard
  // hook's test harness — which only stubs selectProjectData — keeps working without extra mocks.
  const writingHistory = useMemo(() => project.writingHistory ?? [], [project.writingHistory]);

  // Personalized greeting + momentum metrics ----------------------------------
  const greetingKey = useMemo(() => greetingKeyForHour(new Date().getHours()), []);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const wordsToday = useMemo(
    () => writingHistory.find((h) => h.date === todayStr)?.words ?? 0,
    [writingHistory, todayStr],
  );

  const wordsThisWeek = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    return writingHistory
      .filter((h) => h.date >= weekStartStr)
      .reduce((sum, h) => sum + h.words, 0);
  }, [writingHistory]);

  // QNBS-v3: streak derived from writingHistory directly (not the synced slice value) so the
  // dashboard is accurate even when the Progress view that performs the sync was never opened.
  const { current: streakDays, longest: longestStreak } = useMemo(
    () => computeStreak(writingHistory),
    [writingHistory],
  );

  // 14-day activity sparkline series, gap-filled with zero-word days.
  const recentActivity = useMemo(() => {
    const byDate = new Map(writingHistory.map((h) => [h.date, h.words]));
    const days: { date: string; words: number; isToday: boolean }[] = [];
    const cursor = new Date(todayStr);
    cursor.setDate(cursor.getDate() - 13);
    for (let i = 0; i < 14; i++) {
      const ds = cursor.toISOString().slice(0, 10);
      days.push({ date: ds, words: byDate.get(ds) ?? 0, isToday: ds === todayStr });
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }, [writingHistory, todayStr]);

  const dailyGoalProgress = useMemo(
    () => (dailyGoalWords > 0 ? Math.min(100, (wordsToday / dailyGoalWords) * 100) : 0),
    [wordsToday, dailyGoalWords],
  );
  const weeklyGoalProgress = useMemo(
    () => (weeklyGoalWords > 0 ? Math.min(100, (wordsThisWeek / weeklyGoalWords) * 100) : 0),
    [wordsThisWeek, weeklyGoalWords],
  );

  // "Continue writing" target — the last scene with prose, falling back to the first scene.
  const continueSection = useMemo(() => {
    const manuscript = project.manuscript ?? [];
    const withContent = manuscript.filter((s) => s.content?.trim());
    const target = withContent[withContent.length - 1] ?? manuscript[0] ?? null;
    return target ? { id: target.id, title: target.title } : null;
  }, [project.manuscript]);

  // Manuscript composition -----------------------------------------------------
  const sceneCount = project.manuscript?.length ?? 0;

  const readingTimeMinutes = useMemo(
    () => (wordCount === 0 ? 0 : Math.max(1, Math.round(wordCount / READING_WPM))),
    [wordCount],
  );

  const avgWordsPerScene = useMemo(
    () => (sceneCount > 0 ? Math.round(wordCount / sceneCount) : 0),
    [wordCount, sceneCount],
  );

  const statusCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const section of project.manuscript ?? []) {
      const key = section.status ?? 'untracked';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [project.manuscript]);

  // Pace projection ------------------------------------------------------------
  const goalTotal = project.projectGoals?.totalWordCount ?? 0;
  const wordsRemaining = Math.max(0, goalTotal - wordCount);
  const requiredPerDay = useMemo(() => {
    if (daysLeft === null || daysLeft <= 0 || wordsRemaining <= 0) return null;
    return Math.ceil(wordsRemaining / daysLeft);
  }, [daysLeft, wordsRemaining]);
  const paceStatus = useMemo<'done' | 'ontrack' | 'behind' | null>(() => {
    if (goalTotal > 0 && wordsRemaining === 0) return 'done';
    if (requiredPerDay === null) return null;
    return wordsToday >= requiredPerDay ? 'ontrack' : 'behind';
  }, [goalTotal, wordsRemaining, requiredPerDay, wordsToday]);

  // Project health breakdown (shared by the gauge + per-dimension bars) ---------
  const healthBreakdown = useMemo(() => {
    const writing =
      goalTotal > 0
        ? Math.min(100, (wordCount / goalTotal) * 100)
        : Math.min(100, (wordCount / 2500) * 100);
    const cast = Math.min(100, characters.length * 10);
    const world = Math.min(100, worlds.length * 15);
    const score = Math.round(writing * 0.55 + cast * 0.225 + world * 0.225);
    return {
      writing: Math.round(writing),
      cast: Math.round(cast),
      world: Math.round(world),
      score,
    };
  }, [goalTotal, wordCount, characters.length, worlds.length]);

  // Handlers
  const openGoalModal = useCallback(() => {
    setGoalWordCount(project.projectGoals?.totalWordCount || 50000);
    const date = project.projectGoals?.targetDate;
    setGoalTargetDate(date || '');
    setIsGoalModalOpen(true);
  }, [project.projectGoals]);

  const handleSaveGoals = useCallback(() => {
    dispatch(
      projectActions.updateProjectGoal({ key: 'totalWordCount', value: Number(goalWordCount) }),
    );
    dispatch(
      projectActions.updateProjectGoal({ key: 'targetDate', value: goalTargetDate || null }),
    );
    setIsGoalModalOpen(false);
  }, [dispatch, goalWordCount, goalTargetDate]);

  const handleGenerateLoglines = useCallback(async () => {
    const requestId = ++loglineRequestRef.current;
    // QNBS-v3 (#713): live store read (not the projectIdentity selector value) so this check doesn't depend on this component's own render/effect cycle having caught up yet.
    const capturedProjectIdentity = captureActiveProjectIdentity();
    setIsAiLoading(true);
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(true);
    try {
      const result = await dispatch(generateLoglineSuggestionsThunk(language)).unwrap();
      if (
        loglineRequestRef.current !== requestId ||
        !identityUnchanged(capturedProjectIdentity, captureActiveProjectIdentity())
      )
        return;
      loglineGeneratedForIdentityRef.current = capturedProjectIdentity;
      setLoglineSuggestions(result || []);
    } catch (e: unknown) {
      if (loglineRequestRef.current !== requestId) return;
      toast.error(
        t('error.apiErrorTitle'),
        typeof e === 'string' ? e : t('error.apiErrorDescription'),
      );
      setIsLoglineModalOpen(false);
    } finally {
      if (loglineRequestRef.current === requestId) setIsAiLoading(false);
    }
  }, [dispatch, language, t, toast]);

  const selectLogline = useCallback(
    (logline: string) => {
      // QNBS-v3 (#713): reject a stale suggestion independently of the array already having been cleared by the invalidation effect above -- matches useManuscriptView.ts's selectLogline guard.
      if (
        !identityUnchanged(loglineGeneratedForIdentityRef.current, captureActiveProjectIdentity())
      ) {
        setIsLoglineModalOpen(false);
        return;
      }
      dispatch(projectActions.updateLogline(logline));
      setIsLoglineModalOpen(false);
      // QNBS-v3: reassure the user the AI logline is reversible (project slice is redux-undo wrapped),
      // so applying a suggestion never feels like a destructive overwrite.
      toast.success(t('dashboard.logline.updated'), t('dashboard.logline.updatedUndo'));
    },
    [dispatch, toast, t],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      dispatch(projectActions.updateTitle(value));
    },
    [dispatch],
  );

  const handleLoglineChange = useCallback(
    (value: string) => {
      dispatch(projectActions.updateLogline(value));
    },
    [dispatch],
  );

  return {
    t,
    project,
    characters,
    worlds,
    wordCount,
    wordCountProgress,
    readability,
    sceneTimelineHints,
    daysLeft,
    onNavigate,
    // Header / greeting
    greetingKey,
    continueSection,
    // Momentum
    streakDays,
    longestStreak,
    dailyGoalWords,
    weeklyGoalWords,
    wordsToday,
    wordsThisWeek,
    dailyGoalProgress,
    weeklyGoalProgress,
    recentActivity,
    // Composition
    sceneCount,
    readingTimeMinutes,
    avgWordsPerScene,
    statusCounts,
    // Pace + health
    wordsRemaining,
    requiredPerDay,
    paceStatus,
    healthBreakdown,
    // Goals
    isGoalModalOpen,
    setIsGoalModalOpen,
    goalWordCount,
    setGoalWordCount,
    goalTargetDate,
    setGoalTargetDate,
    openGoalModal,
    handleSaveGoals,
    // Logline AI
    isLoglineModalOpen,
    setIsLoglineModalOpen,
    loglineSuggestions,
    isAiLoading,
    handleGenerateLoglines,
    selectLogline,
    // Meta updates
    handleTitleChange,
    handleLoglineChange,
  };
};

export type UseDashboardReturnType = ReturnType<typeof useDashboard>;
