import { useCallback, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useToast } from '../components/ui/Toast';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { generateLoglineSuggestionsThunk } from '../features/project/thunks/writingThunks';
import type { View } from '../types';
import { useTranslation } from './useTranslation';

export interface UseDashboardProps {
  onNavigate: (view: View) => void;
}

export const useDashboard = ({ onNavigate }: UseDashboardProps) => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const toast = useToast();

  // Logline Generation State
  const [isLoglineModalOpen, setIsLoglineModalOpen] = useState(false);
  const [loglineSuggestions, setLoglineSuggestions] = useState<string[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

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
    setIsAiLoading(true);
    setLoglineSuggestions([]);
    setIsLoglineModalOpen(true);
    try {
      const result = await dispatch(generateLoglineSuggestionsThunk(language)).unwrap();
      setLoglineSuggestions(result || []);
    } catch (e: unknown) {
      toast.error(
        t('error.apiErrorTitle'),
        typeof e === 'string' ? e : t('error.apiErrorDescription'),
      );
      setIsLoglineModalOpen(false);
    } finally {
      setIsAiLoading(false);
    }
  }, [dispatch, language, t, toast]);

  const selectLogline = useCallback(
    (logline: string) => {
      dispatch(projectActions.updateLogline(logline));
      setIsLoglineModalOpen(false);
    },
    [dispatch],
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
    daysLeft,
    onNavigate,
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
