/**
 * Tests for ProForgeOrchestrator.
 * QNBS-v3: All agents and dynamic imports are mocked; only dispatch/getState/Redux wiring is tested.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineConfig } from '../../../features/proForge/types';
import type { OrchestratorContext } from '../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock all 8 agent modules
const mockAgentExecute = vi.fn().mockResolvedValue({
  reviewItems: [],
  metrics: {
    aiCalls: 1,
    tokensConsumed: 100,
    durationMs: 500,
    itemsFound: 0,
    itemsAccepted: 0,
    itemsRejected: 0,
  },
  agentOutput: {},
});

vi.mock('../../../services/proForge/pipelineAgents/diagnosticAgent', () => ({
  DiagnosticAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/structuralAgent', () => ({
  StructuralAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/proseAgent', () => ({
  ProseAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/copyEditAgent', () => ({
  CopyEditAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/proofAgent', () => ({
  ProofAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/productionAgent', () => ({
  ProductionAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/publishingAgent', () => ({
  PublishingAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));
vi.mock('../../../services/proForge/pipelineAgents/analyticsAgent', () => ({
  AnalyticsAgent: class {
    constructor(public ctx: unknown) {}
    execute = mockAgentExecute;
    setRetryFeedback = vi.fn();
  },
}));

// Mock version control slice dynamic import
vi.mock('../../../features/versionControl/versionControlSlice', () => ({
  versionControlActions: {
    createSnapshot: vi.fn((p) => ({ type: 'versionControl/createSnapshot', payload: p })),
    restoreSnapshot: vi.fn((p) => ({ type: 'versionControl/restoreSnapshot', payload: p })),
  },
}));

// Mock proForgeSlice dynamic import
vi.mock('../../../features/proForge/proForgeSlice', () => ({
  startPipeline: vi.fn((p) => ({ type: 'proForge/startPipeline', payload: p })),
  stageStarted: vi.fn((p) => ({ type: 'proForge/stageStarted', payload: p })),
  stageCompleted: vi.fn((p) => ({ type: 'proForge/stageCompleted', payload: p })),
  stageFailed: vi.fn((p) => ({ type: 'proForge/stageFailed', payload: p })),
  pipelineCompleted: vi.fn(() => ({ type: 'proForge/pipelineCompleted' })),
  pipelineAborted: vi.fn(() => ({ type: 'proForge/pipelineAborted' })),
  rollbackToStage: vi.fn((p) => ({ type: 'proForge/rollbackToStage', payload: p })),
  skipStage: vi.fn((p) => ({ type: 'proForge/skipStage', payload: p })),
  submitStageReview: vi.fn((p) => ({ type: 'proForge/submitStageReview', payload: p })),
  proForgeActions: {},
}));

// Mock run-history persistence dynamic import
vi.mock('../../../services/proForge/proForgeHistoryStore', () => ({
  saveRunHistory: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  createProForgeOrchestrator,
  ProForgeOrchestrator,
} from '../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
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
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

function makeMockState(runOverrides: Record<string, unknown> = {}) {
  return {
    project: {
      present: {
        data: {
          id: 'p1',
          title: 'Test Project',
          logline: 'Test logline',
          manuscript: [{ id: 's1', title: 'Chapter 1', content: 'Hello world.' }],
          characters: { entities: {}, ids: [] },
          worlds: { entities: {}, ids: [] },
        },
      },
    },
    versionControl: {
      currentBranchId: 'main',
      branches: [{ id: 'main', headSnapshotId: 'snap-1', name: 'main' }],
      snapshots: [],
      isPanelOpen: false,
    },
    proForge: {
      currentRun: null,
      isRunning: false,
      isLoading: false,
      activeView: 'dashboard',
      history: [],
      ...runOverrides,
    },
    settings: {},
    featureFlags: {},
  };
}

function makeContext(stateOverrides: Record<string, unknown> = {}): OrchestratorContext {
  const state = makeMockState(stateOverrides);
  return {
    dispatch: vi.fn(),
    getState: vi.fn().mockReturnValue(state),
    projectId: 'p1',
    manuscript: [{ id: 's1', title: 'Chapter 1', content: 'Hello world.' }],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProForgeOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentExecute.mockResolvedValue({
      reviewItems: [],
      metrics: {
        aiCalls: 1,
        tokensConsumed: 100,
        durationMs: 500,
        itemsFound: 0,
        itemsAccepted: 0,
        itemsRejected: 0,
      },
      agentOutput: {},
    });
  });

  describe('constructor / factory', () => {
    it('creates an orchestrator instance', () => {
      const orch = new ProForgeOrchestrator(makeContext());
      expect(orch).toBeDefined();
    });

    it('createProForgeOrchestrator factory returns an instance', () => {
      const orch = createProForgeOrchestrator(makeContext());
      expect(orch).toBeInstanceOf(ProForgeOrchestrator);
    });
  });

  describe('startPipeline', () => {
    it('dispatches createSnapshot and startPipeline actions', async () => {
      const ctx = makeContext();
      const orch = new ProForgeOrchestrator(ctx);

      // Return an active run after startPipeline dispatched (so executeStage proceeds)
      let callCount = 0;
      vi.mocked(ctx.getState).mockImplementation(() => {
        callCount++;
        if (callCount > 2) {
          return {
            ...makeMockState({
              currentRun: {
                id: 'run-1',
                status: 'running',
                activeStage: 'intake',
                stages: [],
                config: DEFAULT_CONFIG,
                label: 'Test Run',
                prePipelineSnapshotId: 'snap-1',
              },
              isRunning: true,
            }),
          } as unknown as ReturnType<OrchestratorContext['getState']>;
        }
        return makeMockState() as unknown as ReturnType<OrchestratorContext['getState']>;
      });

      await orch.startPipeline('Test Run', DEFAULT_CONFIG);

      const { versionControlActions } = await import(
        '../../../features/versionControl/versionControlSlice'
      );
      expect(vi.mocked(versionControlActions.createSnapshot)).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Pre-ProForge: Test Run' }),
      );
    });

    it('throws if no project data available', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: { present: null },
        versionControl: makeMockState().versionControl,
        proForge: { currentRun: null },
      } as unknown as ReturnType<OrchestratorContext['getState']>);
      const orch = new ProForgeOrchestrator(ctx);
      await expect(orch.startPipeline('Fail', DEFAULT_CONFIG)).rejects.toThrow(
        'No project data available',
      );
    });

    it('resets the abort signal so a re-run after dispose still completes the stage', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [],
          config: { ...DEFAULT_CONFIG, selectedStages: ['intake'], maxRetries: 0 },
          label: 'Re-run',
        },
        isRunning: true,
      });
      const orch = new ProForgeOrchestrator(ctx);
      // Simulate a prior abort — the constructor-created controller is now aborted.
      orch.dispose();

      await orch.startPipeline('Re-run', {
        ...DEFAULT_CONFIG,
        selectedStages: ['intake'],
        maxRetries: 0,
      });

      const { stageCompleted, stageFailed } = await import(
        '../../../features/proForge/proForgeSlice'
      );
      // Without the reset, the stale aborted signal would trip the post-execute guard → stageFailed.
      expect(vi.mocked(stageCompleted)).toHaveBeenCalled();
      expect(vi.mocked(stageFailed)).not.toHaveBeenCalled();
    });
  });

  describe('executeStage', () => {
    it('dispatches stageStarted and stageCompleted for a valid stage', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'intake',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
          prePipelineSnapshotId: 'snap-0',
        },
        isRunning: true,
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.executeStage('intake');

      const { stageStarted, stageCompleted } = await import(
        '../../../features/proForge/proForgeSlice'
      );
      expect(vi.mocked(stageStarted)).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'intake' }),
      );
      expect(vi.mocked(stageCompleted)).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'intake' }),
      );
    });

    it('dispatches stageFailed when agent throws', async () => {
      mockAgentExecute.mockRejectedValueOnce(new Error('AI error'));
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'intake',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
          prePipelineSnapshotId: 'snap-0',
        },
        isRunning: true,
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.executeStage('intake');

      const { stageFailed } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(stageFailed)).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'intake', error: 'AI error' }),
      );
    });

    it('returns early if no active run', async () => {
      const ctx = makeContext(); // currentRun: null
      const orch = new ProForgeOrchestrator(ctx);
      await orch.executeStage('intake');
      expect(vi.mocked(ctx.dispatch)).not.toHaveBeenCalled();
    });

    it('returns early if run is aborted', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'aborted',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.executeStage('intake');
      expect(vi.mocked(ctx.dispatch)).not.toHaveBeenCalled();
    });
  });

  describe('skipStage', () => {
    it('dispatches skipStage action', async () => {
      const ctx = makeContext();
      const orch = new ProForgeOrchestrator(ctx);
      orch.skipStage('structural');

      const { skipStage } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(skipStage)).toHaveBeenCalledWith({ stage: 'structural' });
    });
  });

  describe('advanceToNextStage', () => {
    it('dispatches pipelineCompleted when analytics is the last stage', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'analytics',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.advanceToNextStage('analytics');

      const { pipelineCompleted } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(pipelineCompleted)).toHaveBeenCalled();
    });

    it('skips stages not in selectedStages and continues', async () => {
      const configWithoutStructural: PipelineConfig = {
        ...DEFAULT_CONFIG,
        selectedStages: ['intake', 'lineProse'], // structural is skipped
      };
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'intake',
          stages: [],
          config: configWithoutStructural,
          label: 'Test',
        },
      });
      // After advancing, ensure lineProse is executed (not structural)
      const orch = new ProForgeOrchestrator(ctx);

      // We can't easily test the full chain without a real Redux store,
      // but we can verify skipStage is dispatched for structural
      await orch.advanceToNextStage('intake');

      const { skipStage } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(skipStage)).toHaveBeenCalledWith({ stage: 'structural' });
    });

    it('returns early if no current run', async () => {
      const ctx = makeContext();
      const orch = new ProForgeOrchestrator(ctx);
      await orch.advanceToNextStage('intake');
      const { pipelineCompleted } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(pipelineCompleted)).not.toHaveBeenCalled();
    });
  });

  describe('submitReview', () => {
    it('dispatches submitStageReview with decisions', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'intake',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      const decisions = [{ itemId: 'item-1', status: 'accepted' as const }];

      await orch.submitReview('intake', decisions, { advance: false });

      const { submitStageReview } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(submitStageReview)).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'intake', decisions }),
      );
    });

    it('calls advanceToNextStage when advance is not false', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'analytics', // last stage → pipelineCompleted
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.submitReview('analytics', [], { advance: true });

      const { pipelineCompleted } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(pipelineCompleted)).toHaveBeenCalled();
    });
  });

  describe('submitReview — applying accepted edits to the manuscript', () => {
    const editItem = {
      id: 'e1',
      stage: 'lineProse',
      type: 'proseEdit',
      severity: 'info',
      sectionId: 's1',
      range: { start: 0, end: 5 },
      original: 'Hello',
      proposed: 'Hi',
      description: 'Tighten greeting',
      confidence: 0.9,
      status: 'accepted',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    function findUpdate(ctx: OrchestratorContext) {
      const calls = (ctx.dispatch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      return calls
        .map((c) => c[0] as { payload?: { id?: string; changes?: { content?: string } } })
        .find((a) => a?.payload?.changes?.content !== undefined);
    }

    it('writes accepted edits into the section content (editing stage)', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'awaitingReview',
          activeStage: 'lineProse',
          label: 'Edit Test',
          config: DEFAULT_CONFIG,
          stages: [{ stage: 'lineProse', status: 'awaitingReview', reviewItems: [editItem] }],
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.submitReview('lineProse', [{ itemId: 'e1', status: 'accepted' }], {
        advance: false,
      });

      const update = findUpdate(ctx);
      expect(update?.payload?.id).toBe('s1');
      expect(update?.payload?.changes?.content).toBe('Hi world.');
    });

    it('does not modify the manuscript for non-editing stages', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'awaitingReview',
          activeStage: 'publishing',
          label: 'Edit Test',
          config: DEFAULT_CONFIG,
          stages: [
            {
              stage: 'publishing',
              status: 'awaitingReview',
              reviewItems: [{ ...editItem, stage: 'publishing' }],
            },
          ],
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.submitReview('publishing', [{ itemId: 'e1', status: 'accepted' }], {
        advance: false,
      });

      expect(findUpdate(ctx)).toBeUndefined();
    });

    it('does not apply rejected edits', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'awaitingReview',
          activeStage: 'lineProse',
          label: 'Edit Test',
          config: DEFAULT_CONFIG,
          stages: [{ stage: 'lineProse', status: 'awaitingReview', reviewItems: [editItem] }],
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.submitReview('lineProse', [{ itemId: 'e1', status: 'rejected' }], {
        advance: false,
      });

      expect(findUpdate(ctx)).toBeUndefined();
    });
  });

  describe('run-history persistence', () => {
    it('persists run history to IDB on completion', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'analytics',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Done',
        },
        runHistory: [{ id: 'run-1', label: 'Done' }],
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.advanceToNextStage('analytics');

      const { saveRunHistory } = await import('../../../services/proForge/proForgeHistoryStore');
      expect(vi.mocked(saveRunHistory)).toHaveBeenCalledWith('p1', [
        { id: 'run-1', label: 'Done' },
      ]);
    });

    it('persists run history to IDB on abort', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          activeStage: 'structural',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Aborted',
          prePipelineSnapshotId: 'snap-pre',
        },
        runHistory: [{ id: 'run-1', label: 'Aborted' }],
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.abortPipeline();

      const { saveRunHistory } = await import('../../../services/proForge/proForgeHistoryStore');
      expect(vi.mocked(saveRunHistory)).toHaveBeenCalledWith('p1', [
        { id: 'run-1', label: 'Aborted' },
      ]);
    });
  });

  describe('rollbackTo', () => {
    it('dispatches rollbackToStage', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [{ stage: 'intake', preSnapshotId: 'snap-intake' }],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.rollbackTo('intake');

      const { rollbackToStage } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(rollbackToStage)).toHaveBeenCalledWith({ stage: 'intake' });
    });

    it('dispatches restoreSnapshot if preSnapshotId exists', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [{ stage: 'intake', preSnapshotId: 'snap-intake' }],
          config: DEFAULT_CONFIG,
          label: 'Test',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.rollbackTo('intake');

      const { versionControlActions } = await import(
        '../../../features/versionControl/versionControlSlice'
      );
      expect(
        vi.mocked(
          (
            versionControlActions as unknown as {
              restoreSnapshot: (...args: unknown[]) => unknown;
            }
          ).restoreSnapshot,
        ),
      ).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-intake' }));
    });

    it('returns early if no current run', async () => {
      const ctx = makeContext();
      const orch = new ProForgeOrchestrator(ctx);
      await orch.rollbackTo('intake');
      const { rollbackToStage } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(rollbackToStage)).not.toHaveBeenCalled();
    });
  });

  describe('abortPipeline', () => {
    it('dispatches pipelineAborted', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
          prePipelineSnapshotId: 'snap-pre',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.abortPipeline();

      const { pipelineAborted } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(pipelineAborted)).toHaveBeenCalled();
    });

    it('restores pre-pipeline snapshot on abort', async () => {
      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [],
          config: DEFAULT_CONFIG,
          label: 'Test',
          prePipelineSnapshotId: 'snap-pre-pipeline',
        },
      });
      const orch = new ProForgeOrchestrator(ctx);
      await orch.abortPipeline();

      const { versionControlActions } = await import(
        '../../../features/versionControl/versionControlSlice'
      );
      expect(
        vi.mocked(
          (
            versionControlActions as unknown as {
              restoreSnapshot: (...args: unknown[]) => unknown;
            }
          ).restoreSnapshot,
        ),
      ).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-pre-pipeline' }));
    });

    it('returns early if no current run', async () => {
      const ctx = makeContext();
      const orch = new ProForgeOrchestrator(ctx);
      await orch.abortPipeline();
      const { pipelineAborted } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(pipelineAborted)).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('aborts the internal controller without throwing', () => {
      const orch = new ProForgeOrchestrator(makeContext());
      expect(() => orch.dispose()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 0 Integration Tests
  // ---------------------------------------------------------------------------

  describe('integration: full 8-stage happy path', () => {
    // QNBS-v3: Verifies all 8 agent invocations + pipelineCompleted at the end.
    it('runs all 8 stages and dispatches pipelineCompleted', async () => {
      const allStages: import('../../../features/proForge/types').PipelineStage[] = [
        'intake',
        'structural',
        'lineProse',
        'copyEdit',
        'proof',
        'production',
        'publishing',
        'analytics',
      ];

      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [],
          config: { ...DEFAULT_CONFIG, selectedStages: allStages, maxRetries: 0 },
          label: 'Happy Path',
        },
        isRunning: true,
      });

      const orch = new ProForgeOrchestrator(ctx);

      for (const stage of allStages) {
        await orch.executeStage(stage);
      }
      await orch.advanceToNextStage('analytics');

      const { stageCompleted, pipelineCompleted } = await import(
        '../../../features/proForge/proForgeSlice'
      );
      expect(vi.mocked(stageCompleted)).toHaveBeenCalledTimes(8);
      expect(vi.mocked(pipelineCompleted)).toHaveBeenCalledTimes(1);
      expect(mockAgentExecute).toHaveBeenCalledTimes(8);
    });
  });

  describe('integration: supervisor retry', () => {
    // QNBS-v3: First supervisor verdict is 'fail' → retry → second verdict 'pass' → stageCompleted.
    it('retries the agent once when supervisor fails first attempt', async () => {
      const { SupervisorAgent } = await import(
        '../../../services/proForge/pipelineAgents/supervisorAgent'
      );

      const evaluateSpy = vi
        .spyOn(SupervisorAgent.prototype, 'evaluate')
        .mockReturnValueOnce({
          pass: false,
          retryRecommended: true,
          qualityScore: 40,
          reasons: ['Quality score below threshold'],
        })
        .mockReturnValueOnce({
          pass: true,
          retryRecommended: false,
          qualityScore: 78,
          reasons: [],
        });

      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [],
          config: { ...DEFAULT_CONFIG, maxRetries: 1 },
          label: 'Retry Test',
        },
        isRunning: true,
      });

      const orch = new ProForgeOrchestrator(ctx);
      await orch.executeStage('intake');

      const { stageCompleted, stageFailed } = await import(
        '../../../features/proForge/proForgeSlice'
      );
      // Agent ran twice (original + 1 retry), then passed on the second attempt
      expect(mockAgentExecute).toHaveBeenCalledTimes(2);
      expect(vi.mocked(stageCompleted)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(stageFailed)).not.toHaveBeenCalled();

      evaluateSpy.mockRestore();
    });
  });

  describe('integration: snapshot rollback after failure', () => {
    // QNBS-v3: When a stage fails mid-run, rollbackTo restores the pre-stage snapshot.
    it('dispatches restoreSnapshot when rolling back after a failed stage', async () => {
      mockAgentExecute.mockRejectedValueOnce(new Error('AI provider timeout'));

      const ctx = makeContext({
        currentRun: {
          id: 'run-1',
          status: 'running',
          stages: [{ stage: 'structural', preSnapshotId: 'snap-structural-pre', status: 'failed' }],
          config: DEFAULT_CONFIG,
          label: 'Rollback Test',
        },
        isRunning: true,
      });

      const orch = new ProForgeOrchestrator(ctx);

      // Execute structural — agent throws
      await orch.executeStage('structural');

      const { stageFailed } = await import('../../../features/proForge/proForgeSlice');
      expect(vi.mocked(stageFailed)).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'structural', error: 'AI provider timeout' }),
      );

      // Roll back to structural
      await orch.rollbackTo('structural');

      const { versionControlActions } = await import(
        '../../../features/versionControl/versionControlSlice'
      );
      expect(
        vi.mocked(
          (
            versionControlActions as unknown as {
              restoreSnapshot: (...args: unknown[]) => unknown;
            }
          ).restoreSnapshot,
        ),
      ).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-structural-pre' }));
    });
  });
});
