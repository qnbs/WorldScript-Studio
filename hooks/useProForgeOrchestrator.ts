/**
 * useProForgeOrchestrator — Business logic hook for the ProForge pipeline.
 * QNBS-v3: Bridges Redux state, orchestrator, and UI components.
 */

import { useCallback, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { proForgeActions } from '../features/proForge/proForgeSlice';
import type { PipelineConfig, PipelineStage, ReviewItemStatus } from '../features/proForge/types';
import { createProForgeOrchestrator } from '../services/proForge/proForgeOrchestrator';
import { useTranslation } from './useTranslation';

export function useProForgeOrchestrator() {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const proForgeState = useAppSelector((state) => state.proForge);
  const project = useAppSelector((state) => state.project.present?.data);
  const settings = useAppSelector((state) => state.settings);
  const featureFlags = useAppSelector((state) => state.featureFlags);

  const orchestratorRef = useRef<ReturnType<typeof createProForgeOrchestrator> | null>(null);

  const currentRun = proForgeState.currentRun;
  const isRunning = proForgeState.isRunning;
  const isLoading = proForgeState.isLoading;
  const activeView = proForgeState.activeView;

  // Build default config from settings
  const defaultConfig: PipelineConfig = useMemo(
    () => ({
      genrePreset: 'general-fiction',
      selectedStages: [
        'intake',
        'structural',
        'lineProse',
        'copyEdit',
        'proof',
        'production',
        'publishing',
        'analytics',
      ],
      aiProvider: settings.advancedAi.provider,
      ragMode: settings.advancedAi.ragMode ?? 'hybrid',
      maxTokens: settings.advancedAi.maxTokens ?? 8000,
      creativity: settings.advancedAi.creativity ?? 'Balanced',
      useDuckDb: featureFlags.enableDuckDbAnalytics,
      autoAcceptThreshold: 0,
      language,
    }),
    [settings.advancedAi, featureFlags.enableDuckDbAnalytics, language],
  );

  const getOrchestrator = useCallback(() => {
    if (!project) return null;
    if (!orchestratorRef.current) {
      orchestratorRef.current = createProForgeOrchestrator({
        dispatch,
        getState: () =>
          ({
            ...orchestratorRef.current!.context.getState(),
            proForge: proForgeState,
          }) as import('../app/store').RootState,
        projectId: project.id || 'default',
        manuscript: project.manuscript.map((s) => ({
          id: s.id,
          title: s.title,
          content: s.content ?? '',
        })),
        characters: Object.values(project.characters?.entities ?? {})
          .filter(Boolean)
          .map((c) => ({ id: (c as { id: string }).id, name: (c as { name: string }).name })),
        worlds: Object.values(project.worlds?.entities ?? {})
          .filter(Boolean)
          .map((w) => ({ id: (w as { id: string }).id, name: (w as { name: string }).name })),
        config: currentRun?.config ?? defaultConfig,
      });
    }
    return orchestratorRef.current;
  }, [dispatch, project, proForgeState, defaultConfig, currentRun?.config]);

  const startPipeline = useCallback(
    async (label: string, config: PipelineConfig) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return;
      await orchestrator.startPipeline(label, config);
    },
    [getOrchestrator],
  );

  const abortPipeline = useCallback(async () => {
    const orchestrator = getOrchestrator();
    if (!orchestrator) return;
    await orchestrator.abortPipeline();
  }, [getOrchestrator]);

  const submitReview = useCallback(
    async (
      stage: PipelineStage,
      decisions: Array<{ itemId: string; status: ReviewItemStatus }>,
    ) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return;
      await orchestrator.submitReview(stage, decisions, { advance: true });
    },
    [getOrchestrator],
  );

  const skipStage = useCallback(
    (stage: PipelineStage) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return;
      orchestrator.skipStage(stage);
    },
    [getOrchestrator],
  );

  const rollbackToStage = useCallback(
    async (stage: PipelineStage) => {
      const orchestrator = getOrchestrator();
      if (!orchestrator) return;
      await orchestrator.rollbackTo(stage);
    },
    [getOrchestrator],
  );

  const setActiveView = useCallback(
    (view: typeof proForgeState.activeView) => {
      dispatch(proForgeActions.setActiveView(view));
    },
    [dispatch],
  );

  const activeStageResult = useMemo(() => {
    if (!currentRun) return null;
    return currentRun.stages.find((s) => s.stage === currentRun.activeStage) ?? null;
  }, [currentRun]);

  const currentStageReviewItems = useMemo(() => {
    return activeStageResult?.reviewItems ?? [];
  }, [activeStageResult]);

  return {
    t,
    proForgeState,
    currentRun,
    isRunning,
    isLoading,
    activeView,
    activeStageResult,
    currentStageReviewItems,
    defaultConfig,
    startPipeline,
    abortPipeline,
    submitReview,
    skipStage,
    rollbackToStage,
    setActiveView,
    dispatch,
  };
}

export type UseProForgeOrchestratorReturn = ReturnType<typeof useProForgeOrchestrator>;
