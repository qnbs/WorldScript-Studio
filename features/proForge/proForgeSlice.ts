/**
 * ProForge Pipeline Redux Slice
 * QNBS-v3: State machine for the 8-stage agentic pipeline with Human-in-the-Loop gates.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuid } from 'uuid';
import type {
  PipelineConfig,
  PipelineRun,
  PipelineStage,
  ProForgeState,
  ReviewItemStatus,
  StageResult,
  TraceLogEntry,
} from './types';
import { DEFAULT_PIPELINE_CONFIG } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTraceEntry(
  action: TraceLogEntry['action'],
  message: string,
  stage?: PipelineStage,
  payload?: unknown,
): TraceLogEntry {
  return {
    id: uuid(),
    timestamp: new Date().toISOString(),
    action,
    stage,
    message,
    payload,
  };
}

function createEmptyStageResult(stage: PipelineStage): StageResult {
  return {
    stage,
    status: 'pending',
    reviewItems: [],
    metrics: {
      aiCalls: 0,
      tokensConsumed: 0,
      durationMs: 0,
      itemsFound: 0,
      itemsAccepted: 0,
      itemsRejected: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Initial State
// ---------------------------------------------------------------------------

const initialState: ProForgeState = {
  isActive: false,
  activeView: 'dashboard',
  currentRun: null,
  runHistory: [],
  defaultConfig: DEFAULT_PIPELINE_CONFIG,
  isRunning: false,
  isLoading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const proForgeSlice = createSlice({
  name: 'proForge',
  initialState,
  reducers: {
    // -----------------------------------------------------------------------
    // Global UI
    // -----------------------------------------------------------------------

    setProForgeActive(state, action: PayloadAction<boolean>) {
      state.isActive = action.payload;
      if (!action.payload) {
        state.activeView = 'dashboard';
      }
    },

    setActiveView(
      state,
      action: PayloadAction<'dashboard' | 'wizard' | 'review' | 'trace' | 'settings'>,
    ) {
      state.activeView = action.payload;
    },

    setDefaultConfig(state, action: PayloadAction<Partial<PipelineConfig>>) {
      state.defaultConfig = { ...state.defaultConfig, ...action.payload };
    },

    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },

    clearError(state) {
      state.error = null;
    },

    // -----------------------------------------------------------------------
    // Pipeline Lifecycle
    // -----------------------------------------------------------------------

    startPipeline(
      state,
      action: PayloadAction<{
        projectId: string;
        label: string;
        config: PipelineConfig;
        preSnapshotId: string;
      }>,
    ) {
      const { projectId, label, config, preSnapshotId } = action.payload;
      const run: PipelineRun = {
        id: uuid(),
        projectId,
        label,
        config,
        status: 'running',
        activeStage: 'intake',
        stages: [],
        startedAt: new Date().toISOString(),
        prePipelineSnapshotId: preSnapshotId,
        traceLog: [
          createTraceEntry('pipelineStarted', `Pipeline "${label}" started`, undefined, { config }),
          createTraceEntry('snapshotCreated', 'Pre-pipeline snapshot created', undefined, {
            snapshotId: preSnapshotId,
          }),
        ],
      };
      state.currentRun = run;
      state.isRunning = true;
      state.isLoading = true;
      state.error = null;
    },

    abortPipeline(state) {
      if (!state.currentRun) return;
      state.currentRun.status = 'aborted';
      state.currentRun.completedAt = new Date().toISOString();
      state.currentRun.traceLog.push(
        createTraceEntry(
          'pipelineAborted',
          'Pipeline aborted by user',
          state.currentRun.activeStage,
        ),
      );
      state.isRunning = false;
      state.isLoading = false;
      // Move to history
      state.runHistory.unshift(state.currentRun);
    },

    completePipeline(state) {
      if (!state.currentRun) return;
      state.currentRun.status = 'completed';
      state.currentRun.completedAt = new Date().toISOString();
      state.currentRun.traceLog.push(
        createTraceEntry('pipelineCompleted', 'Pipeline completed successfully'),
      );
      state.isRunning = false;
      state.isLoading = false;
      state.runHistory.unshift(state.currentRun);
    },

    // -----------------------------------------------------------------------
    // Stage Management
    // -----------------------------------------------------------------------

    stageStarted(state, action: PayloadAction<{ stage: PipelineStage; snapshotId?: string }>) {
      if (!state.currentRun) return;
      const { stage, snapshotId } = action.payload;
      const existing = state.currentRun.stages.find((s) => s.stage === stage);
      if (!existing) {
        state.currentRun.stages.push(createEmptyStageResult(stage));
      }
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (stageResult) {
        stageResult.status = 'running';
        stageResult.startedAt = new Date().toISOString();
        stageResult.preSnapshotId = snapshotId;
      }
      state.currentRun.activeStage = stage;
      state.currentRun.traceLog.push(
        createTraceEntry('stageStarted', `Stage ${stage} started`, stage),
      );
      state.isLoading = true;
    },

    stageCompleted(
      state,
      action: PayloadAction<{ stage: PipelineStage; result: Partial<StageResult> }>,
    ) {
      if (!state.currentRun) return;
      const { stage, result } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) return;
      stageResult.status = 'awaitingReview';
      stageResult.completedAt = new Date().toISOString();
      if (result.reviewItems) stageResult.reviewItems = result.reviewItems;
      if (result.metrics) stageResult.metrics = { ...stageResult.metrics, ...result.metrics };
      if (result.agentOutput) stageResult.agentOutput = result.agentOutput;
      if (result.supervisorDecision !== undefined)
        stageResult.supervisorDecision = result.supervisorDecision;
      stageResult.metrics.itemsFound = stageResult.reviewItems.length;
      state.currentRun.status = 'awaitingReview';
      state.currentRun.traceLog.push(
        createTraceEntry(
          'stageCompleted',
          `Stage ${stage} completed with ${stageResult.reviewItems.length} items`,
          stage,
        ),
      );
      state.isLoading = false;
    },

    stageFailed(state, action: PayloadAction<{ stage: PipelineStage; error: string }>) {
      if (!state.currentRun) return;
      const { stage, error } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (stageResult) {
        stageResult.status = 'failed';
        stageResult.error = error;
        stageResult.completedAt = new Date().toISOString();
      }
      state.currentRun.status = 'failed';
      state.isRunning = false;
      state.isLoading = false;
      state.error = error;
      state.currentRun.traceLog.push(
        createTraceEntry('stageFailed', `Stage ${stage} failed: ${error}`, stage),
      );
    },

    // -----------------------------------------------------------------------
    // Review / Human-in-the-Loop
    // -----------------------------------------------------------------------

    submitStageReview(
      state,
      action: PayloadAction<{
        stage: PipelineStage;
        decisions: Array<{ itemId: string; status: ReviewItemStatus }>;
        postSnapshotId?: string;
      }>,
    ) {
      if (!state.currentRun) return;
      const { stage, decisions, postSnapshotId } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) return;

      for (const d of decisions) {
        const item = stageResult.reviewItems.find((ri) => ri.id === d.itemId);
        if (item) {
          item.status = d.status;
          state.currentRun.traceLog.push(
            createTraceEntry(
              d.status === 'accepted'
                ? 'reviewItemAccepted'
                : d.status === 'rejected'
                  ? 'reviewItemRejected'
                  : 'reviewItemIgnored',
              `Item ${d.itemId} marked as ${d.status}`,
              stage,
            ),
          );
        }
      }

      stageResult.metrics.itemsAccepted = stageResult.reviewItems.filter(
        (i) => i.status === 'accepted',
      ).length;
      stageResult.metrics.itemsRejected = stageResult.reviewItems.filter(
        (i) => i.status === 'rejected',
      ).length;
      stageResult.postSnapshotId = postSnapshotId;
      stageResult.status = 'accepted';

      state.currentRun.traceLog.push(
        createTraceEntry('stageAccepted', `Stage ${stage} accepted`, stage, {
          accepted: stageResult.metrics.itemsAccepted,
          rejected: stageResult.metrics.itemsRejected,
        }),
      );
    },

    skipStage(state, action: PayloadAction<{ stage: PipelineStage }>) {
      if (!state.currentRun) return;
      const { stage } = action.payload;
      let stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) {
        stageResult = createEmptyStageResult(stage);
        state.currentRun.stages.push(stageResult);
      }
      stageResult.status = 'skipped';
      state.currentRun.traceLog.push(
        createTraceEntry('stageSkipped', `Stage ${stage} skipped`, stage),
      );
    },

    rollbackToStage(state, action: PayloadAction<{ stage: PipelineStage }>) {
      if (!state.currentRun) return;
      const targetStage = action.payload.stage;
      const targetIdx = state.currentRun.stages.findIndex((s) => s.stage === targetStage);
      if (targetIdx === -1) return;

      // Mark all stages after target as rolled back
      for (let i = targetIdx + 1; i < state.currentRun.stages.length; i++) {
        const s = state.currentRun.stages[i];
        if (s) {
          s.status = 'rolledBack';
          state.currentRun.traceLog.push(
            createTraceEntry('stageRolledBack', `Stage ${s.stage} rolled back`, s.stage),
          );
        }
      }
      state.currentRun.activeStage = targetStage;
      state.currentRun.traceLog.push(
        createTraceEntry('stageRolledBack', `Rolled back to stage ${targetStage}`, targetStage),
      );
    },

    // -----------------------------------------------------------------------
    // Review Item Actions
    // -----------------------------------------------------------------------

    setReviewItemStatus(
      state,
      action: PayloadAction<{
        stage: PipelineStage;
        itemId: string;
        status: ReviewItemStatus;
      }>,
    ) {
      if (!state.currentRun) return;
      const { stage, itemId, status } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) return;
      const item = stageResult.reviewItems.find((ri) => ri.id === itemId);
      if (item) {
        item.status = status;
      }
    },

    acceptAllReviewItems(state, action: PayloadAction<{ stage: PipelineStage }>) {
      if (!state.currentRun) return;
      const { stage } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) return;
      for (const item of stageResult.reviewItems) {
        if (item.status === 'pending') {
          item.status = 'accepted';
        }
      }
    },

    rejectAllReviewItems(state, action: PayloadAction<{ stage: PipelineStage }>) {
      if (!state.currentRun) return;
      const { stage } = action.payload;
      const stageResult = state.currentRun.stages.find((s) => s.stage === stage);
      if (!stageResult) return;
      for (const item of stageResult.reviewItems) {
        if (item.status === 'pending') {
          item.status = 'rejected';
        }
      }
    },

    // -----------------------------------------------------------------------
    // Loading / Error
    // -----------------------------------------------------------------------

    setLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },

    // -----------------------------------------------------------------------
    // Trace Log
    // -----------------------------------------------------------------------

    appendTraceLog(state, action: PayloadAction<TraceLogEntry>) {
      if (!state.currentRun) return;
      state.currentRun.traceLog.push(action.payload);
    },

    // -----------------------------------------------------------------------
    // History
    // -----------------------------------------------------------------------

    loadRunHistory(state, action: PayloadAction<PipelineRun[]>) {
      state.runHistory = action.payload;
    },

    clearHistory(state) {
      state.runHistory = [];
    },

    // -----------------------------------------------------------------------
    // Hydration
    // -----------------------------------------------------------------------

    hydrateProForgeState(state, action: PayloadAction<Partial<ProForgeState>>) {
      return { ...state, ...action.payload };
    },
  },
});

export const proForgeActions = proForgeSlice.actions;

// QNBS-v3: Named exports used by proForgeOrchestrator for direct dispatch calls.
export const {
  startPipeline,
  stageStarted,
  stageCompleted,
  stageFailed,
  submitStageReview,
  skipStage,
  rollbackToStage,
  setProForgeActive,
  setActiveView,
} = proForgeSlice.actions;

// Aliases matching orchestrator's import convention (action-event naming)
export const pipelineAborted = proForgeSlice.actions.abortPipeline;
export const pipelineCompleted = proForgeSlice.actions.completePipeline;

export default proForgeSlice.reducer;
