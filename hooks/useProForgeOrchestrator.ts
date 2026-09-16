/**
 * useProForgeOrchestrator — Business logic hook for the ProForge pipeline.
 * QNBS-v3: Bridges Redux state, orchestrator, and UI components.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { appStoreRef } from '../app/storeRef';
import { proForgeActions } from '../features/proForge/proForgeSlice';
import type { PipelineConfig, PipelineStage, ReviewItemStatus } from '../features/proForge/types';
import { getProjectTargetIdentity } from '../features/project/projectIdentity';
import { createProForgeOrchestrator } from '../services/proForge/proForgeOrchestrator';
import { useTranslation } from './useTranslation';

export function useProForgeOrchestrator() {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const proForgeState = useAppSelector((state) => state.proForge);
  const projectPresent = useAppSelector((state) => state.project.present);
  const project = projectPresent?.data;
  // QNBS-v3 (#713): full incarnation identity (id + generation), not just the bare project id -- a same-id reset/import/restore must still rebuild the cached orchestrator below.
  const projectIdentity = getProjectTargetIdentity(projectPresent);
  // QNBS-v3 (#713 cubic): compared alongside projectIdentity below -- two different id-less projects both resolve to a null identity, which the string comparison alone can't tell apart.
  const projectGeneration = projectPresent?.generation;
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
      aiProvider: settings?.advancedAi?.provider,
      ragMode: settings?.advancedAi?.ragMode ?? 'hybrid',
      maxTokens: settings?.advancedAi?.maxTokens ?? 8000,
      creativity: settings?.aiCreativity ?? 'Balanced',
      useDuckDb: featureFlags?.enableDuckDbAnalytics ?? false,
      autoAcceptThreshold: 0,
      language,
    }),
    [settings, featureFlags, language],
  );

  // QNBS-v3: Track which project incarnation the cached orchestrator was built for, so a switch or a same-id reset/import/restore under a new generation rebuilds it and drops its stale AbortController/context (#713).
  const orchestratorProjectIdentityRef = useRef<string | null>(null);
  const orchestratorProjectGenerationRef = useRef<number | undefined>(undefined);

  // QNBS-v3: Hydrate persisted run history when a project loads — analytics comparisons across
  // runs were lost on reload because the proForge slice is ephemeral. Best-effort.
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadRunHistory } = await import('../services/proForge/proForgeHistoryStore');
        const runs = await loadRunHistory(projectId);
        // QNBS-v3: Always dispatch (even []) so switching to a project with no saved history
        // clears the previous project's run history from Redux instead of leaving it stale.
        if (!cancelled) {
          dispatch(proForgeActions.loadRunHistory(runs));
        }
      } catch {
        // Non-blocking: history hydration failures must not break the view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, dispatch]);

  const getOrchestrator = useCallback(() => {
    if (!project) return null;
    const projectId = project.id || 'default';

    if (
      orchestratorRef.current &&
      (orchestratorProjectIdentityRef.current !== projectIdentity ||
        orchestratorProjectGenerationRef.current !== projectGeneration)
    ) {
      orchestratorRef.current.dispose();
      orchestratorRef.current = null;
    }

    if (!orchestratorRef.current) {
      orchestratorRef.current = createProForgeOrchestrator({
        dispatch,
        // QNBS-v3: Read the LIVE store (was self-referential → infinite recursion + stale state).
        getState: () => appStoreRef.current!.getState(),
        projectId,
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
        // QNBS-v3: Live config getter — agents read this.context.config at execute time,
        // so a custom config passed to startPipeline must win over the build-time default.
        get config() {
          return appStoreRef.current!.getState().proForge.currentRun?.config ?? defaultConfig;
        },
      });
      orchestratorProjectIdentityRef.current = projectIdentity;
      orchestratorProjectGenerationRef.current = projectGeneration;
    }
    return orchestratorRef.current;
  }, [dispatch, project, defaultConfig, projectIdentity, projectGeneration]);

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
