import { describe, expect, it } from 'vitest';
import proForgeReducer, { proForgeActions } from '../../features/proForge/proForgeSlice';
import type {
  PipelineConfig,
  PipelineRun,
  ProForgeState,
  ReviewItem,
  TraceLogEntry,
} from '../../features/proForge/types';
import {
  DEFAULT_PIPELINE_CONFIG,
  EDITING_STAGES,
  isEditingStage,
  nextStage,
  PIPELINE_STAGES,
  prevStage,
} from '../../features/proForge/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReviewItem(overrides?: Partial<ReviewItem>): ReviewItem {
  return {
    id: 'item-1',
    stage: 'structural',
    type: 'structuralEdit',
    severity: 'warning',
    description: 'Weak opening act',
    confidence: 0.8,
    status: 'pending',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  return { ...DEFAULT_PIPELINE_CONFIG, ...overrides };
}

function startPipelinePayload() {
  return {
    projectId: 'proj-1',
    label: 'Test Run',
    config: makeConfig(),
    preSnapshotId: 'snap-pre',
  };
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

describe('PIPELINE_STAGES', () => {
  it('contains all expected stages in order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'idle',
      'intake',
      'structural',
      'lineProse',
      'copyEdit',
      'proof',
      'production',
      'publishing',
      'analytics',
      'archived',
    ]);
  });
});

describe('EDITING_STAGES', () => {
  it('contains only the editing stages', () => {
    expect(EDITING_STAGES).toEqual(['intake', 'structural', 'lineProse', 'copyEdit', 'proof']);
  });
});

describe('isEditingStage', () => {
  it('returns true for editing stages', () => {
    for (const s of EDITING_STAGES) {
      expect(isEditingStage(s)).toBe(true);
    }
  });

  it('returns false for non-editing stages', () => {
    expect(isEditingStage('production')).toBe(false);
    expect(isEditingStage('publishing')).toBe(false);
    expect(isEditingStage('analytics')).toBe(false);
    expect(isEditingStage('idle')).toBe(false);
    expect(isEditingStage('archived')).toBe(false);
  });
});

describe('nextStage', () => {
  it('returns the next stage for each non-last stage', () => {
    expect(nextStage('idle')).toBe('intake');
    expect(nextStage('intake')).toBe('structural');
    expect(nextStage('structural')).toBe('lineProse');
    expect(nextStage('analytics')).toBe('archived');
  });

  it('returns null for the last stage', () => {
    expect(nextStage('archived')).toBeNull();
  });
});

describe('prevStage', () => {
  it('returns the previous stage', () => {
    expect(prevStage('intake')).toBe('idle');
    expect(prevStage('structural')).toBe('intake');
    expect(prevStage('archived')).toBe('analytics');
  });

  it('returns null for the first stage', () => {
    expect(prevStage('idle')).toBeNull();
  });
});

describe('DEFAULT_PIPELINE_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_PIPELINE_CONFIG.genrePreset).toBe('general-fiction');
    expect(DEFAULT_PIPELINE_CONFIG.aiProvider).toBe('gemini');
    expect(DEFAULT_PIPELINE_CONFIG.ragMode).toBe('hybrid');
    expect(DEFAULT_PIPELINE_CONFIG.creativity).toBe('Balanced');
    expect(DEFAULT_PIPELINE_CONFIG.autoAcceptThreshold).toBe(0);
    expect(DEFAULT_PIPELINE_CONFIG.selectedStages).toContain('intake');
    expect(DEFAULT_PIPELINE_CONFIG.selectedStages).toContain('analytics');
  });
});

// ---------------------------------------------------------------------------
// Reducer initial state
// ---------------------------------------------------------------------------

describe('proForgeReducer initial state', () => {
  it('initializes with correct defaults', () => {
    const state = proForgeReducer(undefined, { type: '@@INIT' });
    expect(state).toMatchObject<ProForgeState>({
      isActive: false,
      activeView: 'dashboard',
      currentRun: null,
      runHistory: [],
      defaultConfig: DEFAULT_PIPELINE_CONFIG,
      isRunning: false,
      isLoading: false,
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Global UI actions
// ---------------------------------------------------------------------------

describe('setProForgeActive', () => {
  it('activates ProForge mode', () => {
    const state = proForgeReducer(undefined, proForgeActions.setProForgeActive(true));
    expect(state.isActive).toBe(true);
  });

  it('deactivates ProForge mode and resets activeView to dashboard', () => {
    let state = proForgeReducer(undefined, proForgeActions.setProForgeActive(true));
    state = proForgeReducer(state, proForgeActions.setActiveView('review'));
    state = proForgeReducer(state, proForgeActions.setProForgeActive(false));
    expect(state.isActive).toBe(false);
    expect(state.activeView).toBe('dashboard');
  });
});

describe('setActiveView', () => {
  it('changes the active view', () => {
    const state = proForgeReducer(undefined, proForgeActions.setActiveView('wizard'));
    expect(state.activeView).toBe('wizard');
  });
});

describe('setDefaultConfig', () => {
  it('merges partial config into defaultConfig', () => {
    const state = proForgeReducer(
      undefined,
      proForgeActions.setDefaultConfig({ genrePreset: 'thriller', maxTokens: 16000 }),
    );
    expect(state.defaultConfig.genrePreset).toBe('thriller');
    expect(state.defaultConfig.maxTokens).toBe(16000);
    // Other defaults unchanged
    expect(state.defaultConfig.aiProvider).toBe('gemini');
  });
});

describe('setError / clearError', () => {
  it('sets an error message', () => {
    const state = proForgeReducer(undefined, proForgeActions.setError('Something went wrong'));
    expect(state.error).toBe('Something went wrong');
  });

  it('clears an error message', () => {
    let state = proForgeReducer(undefined, proForgeActions.setError('Oh no'));
    state = proForgeReducer(state, proForgeActions.clearError());
    expect(state.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

describe('startPipeline', () => {
  it('creates a new currentRun with running status', () => {
    const state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    expect(state.currentRun).not.toBeNull();
    expect(state.currentRun?.status).toBe('running');
    expect(state.currentRun?.activeStage).toBe('intake');
    expect(state.currentRun?.projectId).toBe('proj-1');
    expect(state.currentRun?.label).toBe('Test Run');
    expect(state.currentRun?.prePipelineSnapshotId).toBe('snap-pre');
    expect(state.isRunning).toBe(true);
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
  });

  it('initializes trace log with pipelineStarted and snapshotCreated entries', () => {
    const state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    const actions = state.currentRun?.traceLog.map((e) => e.action);
    expect(actions).toContain('pipelineStarted');
    expect(actions).toContain('snapshotCreated');
  });
});

describe('abortPipeline', () => {
  it('marks run as aborted and moves to history', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.abortPipeline());
    expect(state.currentRun?.status).toBe('aborted');
    expect(state.isRunning).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.runHistory).toHaveLength(1);
    expect(state.runHistory[0]?.status).toBe('aborted');
  });

  it('appends pipelineAborted to trace log', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.abortPipeline());
    const traceActions = state.currentRun?.traceLog.map((e) => e.action);
    expect(traceActions).toContain('pipelineAborted');
  });

  it('does nothing when no current run', () => {
    const state = proForgeReducer(undefined, proForgeActions.abortPipeline());
    expect(state.currentRun).toBeNull();
  });
});

describe('completePipeline', () => {
  it('marks run as completed and moves to history', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.completePipeline());
    expect(state.currentRun?.status).toBe('completed');
    expect(state.isRunning).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.runHistory).toHaveLength(1);
  });

  it('does nothing when no current run', () => {
    const state = proForgeReducer(undefined, proForgeActions.completePipeline());
    expect(state.currentRun).toBeNull();
    expect(state.runHistory).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stage management
// ---------------------------------------------------------------------------

describe('stageStarted', () => {
  it('creates a new stage result with running status', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(
      state,
      proForgeActions.stageStarted({ stage: 'structural', snapshotId: 'snap-1' }),
    );
    const structural = state.currentRun?.stages.find((s) => s.stage === 'structural');
    expect(structural?.status).toBe('running');
    expect(structural?.preSnapshotId).toBe('snap-1');
    expect(state.currentRun?.activeStage).toBe('structural');
    expect(state.isLoading).toBe(true);
  });

  it('does not duplicate stage if already exists', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'intake' }));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'intake' }));
    const intakeStages = state.currentRun?.stages.filter((s) => s.stage === 'intake');
    expect(intakeStages?.length).toBe(1);
  });
});

describe('stageCompleted', () => {
  it('sets stage to awaitingReview with review items', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'structural' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageCompleted({
        stage: 'structural',
        result: {
          reviewItems: [makeReviewItem({ id: 'ri-1' }), makeReviewItem({ id: 'ri-2' })],
          metrics: {
            aiCalls: 3,
            tokensConsumed: 500,
            durationMs: 2000,
            itemsFound: 2,
            itemsAccepted: 0,
            itemsRejected: 0,
          },
        },
      }),
    );
    const structural = state.currentRun?.stages.find((s) => s.stage === 'structural');
    expect(structural?.status).toBe('awaitingReview');
    expect(structural?.reviewItems).toHaveLength(2);
    expect(structural?.metrics.aiCalls).toBe(3);
    expect(structural?.metrics.itemsFound).toBe(2);
    expect(state.currentRun?.status).toBe('awaitingReview');
    expect(state.isLoading).toBe(false);
  });
});

describe('stageFailed', () => {
  it('marks stage and pipeline as failed with error', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'intake' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageFailed({ stage: 'intake', error: 'AI provider unavailable' }),
    );
    const intake = state.currentRun?.stages.find((s) => s.stage === 'intake');
    expect(intake?.status).toBe('failed');
    expect(intake?.error).toBe('AI provider unavailable');
    expect(state.currentRun?.status).toBe('failed');
    expect(state.error).toBe('AI provider unavailable');
    expect(state.isRunning).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review / HITL
// ---------------------------------------------------------------------------

describe('submitStageReview', () => {
  it('updates review item statuses and metrics', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'structural' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageCompleted({
        stage: 'structural',
        result: {
          reviewItems: [
            makeReviewItem({ id: 'ri-1', status: 'pending' }),
            makeReviewItem({ id: 'ri-2', status: 'pending' }),
          ],
        },
      }),
    );
    state = proForgeReducer(
      state,
      proForgeActions.submitStageReview({
        stage: 'structural',
        decisions: [
          { itemId: 'ri-1', status: 'accepted' },
          { itemId: 'ri-2', status: 'rejected' },
        ],
        postSnapshotId: 'snap-post',
      }),
    );
    const structural = state.currentRun?.stages.find((s) => s.stage === 'structural');
    expect(structural?.status).toBe('accepted');
    expect(structural?.reviewItems[0]?.status).toBe('accepted');
    expect(structural?.reviewItems[1]?.status).toBe('rejected');
    expect(structural?.metrics.itemsAccepted).toBe(1);
    expect(structural?.metrics.itemsRejected).toBe(1);
    expect(structural?.postSnapshotId).toBe('snap-post');
  });
});

describe('skipStage', () => {
  it('marks stage as skipped without starting it', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.skipStage({ stage: 'lineProse' }));
    const lineProse = state.currentRun?.stages.find((s) => s.stage === 'lineProse');
    expect(lineProse?.status).toBe('skipped');
  });
});

describe('rollbackToStage', () => {
  it('marks stages after target as rolledBack', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'intake' }));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'structural' }));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'lineProse' }));
    state = proForgeReducer(state, proForgeActions.rollbackToStage({ stage: 'intake' }));
    const structural = state.currentRun?.stages.find((s) => s.stage === 'structural');
    const lineProse = state.currentRun?.stages.find((s) => s.stage === 'lineProse');
    expect(structural?.status).toBe('rolledBack');
    expect(lineProse?.status).toBe('rolledBack');
    expect(state.currentRun?.activeStage).toBe('intake');
  });

  it('does nothing when target stage does not exist in stages array', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    const stateBefore = state.currentRun?.stages.length ?? 0;
    state = proForgeReducer(state, proForgeActions.rollbackToStage({ stage: 'structural' }));
    expect(state.currentRun?.stages.length).toBe(stateBefore);
  });
});

// ---------------------------------------------------------------------------
// Review item bulk actions
// ---------------------------------------------------------------------------

describe('setReviewItemStatus', () => {
  it('updates a single item status', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'proof' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageCompleted({
        stage: 'proof',
        result: {
          reviewItems: [makeReviewItem({ id: 'ri-x', stage: 'proof', status: 'pending' })],
        },
      }),
    );
    state = proForgeReducer(
      state,
      proForgeActions.setReviewItemStatus({ stage: 'proof', itemId: 'ri-x', status: 'ignored' }),
    );
    const proof = state.currentRun?.stages.find((s) => s.stage === 'proof');
    expect(proof?.reviewItems[0]?.status).toBe('ignored');
  });
});

describe('acceptAllReviewItems', () => {
  it('accepts all pending items in a stage', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'copyEdit' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageCompleted({
        stage: 'copyEdit',
        result: {
          reviewItems: [
            makeReviewItem({ id: 'a', stage: 'copyEdit', status: 'pending' }),
            makeReviewItem({ id: 'b', stage: 'copyEdit', status: 'rejected' }),
            makeReviewItem({ id: 'c', stage: 'copyEdit', status: 'pending' }),
          ],
        },
      }),
    );
    state = proForgeReducer(state, proForgeActions.acceptAllReviewItems({ stage: 'copyEdit' }));
    const copyEdit = state.currentRun?.stages.find((s) => s.stage === 'copyEdit');
    expect(copyEdit?.reviewItems.find((i) => i.id === 'a')?.status).toBe('accepted');
    expect(copyEdit?.reviewItems.find((i) => i.id === 'b')?.status).toBe('rejected'); // unchanged
    expect(copyEdit?.reviewItems.find((i) => i.id === 'c')?.status).toBe('accepted');
  });
});

describe('rejectAllReviewItems', () => {
  it('rejects all pending items in a stage', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    state = proForgeReducer(state, proForgeActions.stageStarted({ stage: 'proof' }));
    state = proForgeReducer(
      state,
      proForgeActions.stageCompleted({
        stage: 'proof',
        result: {
          reviewItems: [
            makeReviewItem({ id: 'p1', stage: 'proof', status: 'pending' }),
            makeReviewItem({ id: 'p2', stage: 'proof', status: 'accepted' }),
          ],
        },
      }),
    );
    state = proForgeReducer(state, proForgeActions.rejectAllReviewItems({ stage: 'proof' }));
    const proof = state.currentRun?.stages.find((s) => s.stage === 'proof');
    expect(proof?.reviewItems.find((i) => i.id === 'p1')?.status).toBe('rejected');
    expect(proof?.reviewItems.find((i) => i.id === 'p2')?.status).toBe('accepted'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Loading / error / trace
// ---------------------------------------------------------------------------

describe('setLoading', () => {
  it('sets isLoading', () => {
    let state = proForgeReducer(undefined, proForgeActions.setLoading(true));
    expect(state.isLoading).toBe(true);
    state = proForgeReducer(state, proForgeActions.setLoading(false));
    expect(state.isLoading).toBe(false);
  });
});

describe('appendTraceLog', () => {
  it('appends a trace entry to currentRun', () => {
    let state = proForgeReducer(undefined, proForgeActions.startPipeline(startPipelinePayload()));
    const entry: TraceLogEntry = {
      id: 'trace-99',
      timestamp: '2026-01-01T00:00:00Z',
      action: 'error',
      message: 'Custom trace entry',
    };
    state = proForgeReducer(state, proForgeActions.appendTraceLog(entry));
    const found = state.currentRun?.traceLog.find((e) => e.id === 'trace-99');
    expect(found?.message).toBe('Custom trace entry');
  });

  it('does nothing when no current run', () => {
    const state = proForgeReducer(
      undefined,
      proForgeActions.appendTraceLog({
        id: 'x',
        timestamp: '',
        action: 'error',
        message: 'noop',
      }),
    );
    expect(state.currentRun).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe('loadRunHistory / clearHistory', () => {
  it('loads run history from payload', () => {
    const fakeRun = { id: 'r1' } as unknown as PipelineRun;
    const state = proForgeReducer(undefined, proForgeActions.loadRunHistory([fakeRun]));
    expect(state.runHistory).toHaveLength(1);
    expect(state.runHistory[0]?.id).toBe('r1');
  });

  it('clears run history', () => {
    let state = proForgeReducer(
      undefined,
      proForgeActions.loadRunHistory([{ id: 'r2' } as unknown as PipelineRun]),
    );
    state = proForgeReducer(state, proForgeActions.clearHistory());
    expect(state.runHistory).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

describe('hydrateProForgeState', () => {
  it('merges partial state into current state', () => {
    const state = proForgeReducer(
      undefined,
      proForgeActions.hydrateProForgeState({ isActive: true, error: 'hydrated-error' }),
    );
    expect(state.isActive).toBe(true);
    expect(state.error).toBe('hydrated-error');
    expect(state.activeView).toBe('dashboard'); // unchanged
  });
});
