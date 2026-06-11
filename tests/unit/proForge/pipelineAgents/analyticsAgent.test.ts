/**
 * Tests for AnalyticsAgent — ProForge Pipeline Stage 8 (analytics).
 * QNBS-v3: No AI calls; aggregates metrics from state.proForge.currentRun.stages; saves to memoryBank.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects
// ---------------------------------------------------------------------------

const mockMemoryBank = vi.hoisted(() => ({
  buildContextString: vi.fn().mockResolvedValue(''),
  remember: vi.fn().mockResolvedValue({}),
  recall: vi.fn().mockResolvedValue([]),
  search: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: vi.fn(() => mockMemoryBank),
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { AnalyticsAgent } from '../../../../services/proForge/pipelineAgents/analyticsAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['analytics'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

function makeStageResult(stage: string, overrides = {}) {
  return {
    stage,
    status: 'completed',
    reviewItems: [],
    agentOutput: null,
    metrics: {
      aiCalls: 1,
      tokensConsumed: 500,
      durationMs: 1000,
      itemsFound: 3,
      itemsAccepted: 2,
      itemsRejected: 1,
    },
    ...overrides,
  };
}

function makeContext(
  stages = [makeStageResult('intake'), makeStageResult('structural')],
): OrchestratorContext {
  return {
    projectId: 'proj-analytics',
    dispatch: vi.fn() as unknown as OrchestratorContext['dispatch'],
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Analytics Test',
            logline: '',
            manuscript: [],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [],
          },
        },
      },
      proForge: {
        currentRun: {
          id: 'run-1',
          projectId: 'proj-analytics',
          label: 'Test Run',
          config: DEFAULT_CONFIG,
          status: 'completed',
          activeStage: 'analytics',
          stages,
          startedAt: new Date().toISOString(),
          prePipelineSnapshotId: 'snap-1',
          traceLog: [],
        },
        runHistory: [],
        isActive: true,
        activeView: 'dashboard',
        isRunning: true,
        isLoading: false,
        error: null,
        defaultConfig: DEFAULT_CONFIG,
      },
    } as unknown as ReturnType<OrchestratorContext['getState']>),
    manuscript: [],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('no AI calls', () => {
    it('returns aiCalls=0 and tokensConsumed=0', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(0);
      expect(metrics.tokensConsumed).toBe(0);
    });
  });

  describe('metrics aggregation', () => {
    it('aggregates totalAiCalls from all stages', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { metrics: { totalAiCalls: number } };
      // 2 stages × 1 aiCall each = 2
      expect(report.metrics.totalAiCalls).toBe(2);
    });

    it('aggregates totalTokensConsumed from all stages', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { metrics: { totalTokensConsumed: number } };
      // 2 stages × 500 tokens = 1000
      expect(report.metrics.totalTokensConsumed).toBe(1000);
    });

    it('aggregates totalEditsFound and totalEditsAccepted from all stages', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as {
        metrics: {
          totalEditsFound: number;
          totalEditsAccepted: number;
          totalEditsRejected: number;
        };
      };
      expect(report.metrics.totalEditsFound).toBe(6); // 3 × 2 stages
      expect(report.metrics.totalEditsAccepted).toBe(4); // 2 × 2 stages
      expect(report.metrics.totalEditsRejected).toBe(2); // 1 × 2 stages
    });

    it('stageDurations contains an entry per stage', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { metrics: { stageDurations: Record<string, number> } };
      expect(report.metrics.stageDurations).toHaveProperty('intake');
      expect(report.metrics.stageDurations).toHaveProperty('structural');
    });

    it('runId matches the currentRun id', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { runId: string };
      expect(report.runId).toBe('run-1');
    });
  });

  describe('lessons learned', () => {
    it('whatWorked is a non-empty array', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { lessonsLearned: { whatWorked: string[] } };
      expect(report.lessonsLearned.whatWorked.length).toBeGreaterThan(0);
    });

    it('recommendations is a non-empty array', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { lessonsLearned: { recommendations: string[] } };
      expect(report.lessonsLearned.recommendations.length).toBeGreaterThan(0);
    });

    it('whatDidntWork contains a message when edits were rejected', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { lessonsLearned: { whatDidntWork: string[] } };
      expect(report.lessonsLearned.whatDidntWork.length).toBeGreaterThan(0);
    });

    it('whatDidntWork is empty when no edits were rejected', async () => {
      const stages = [
        makeStageResult('intake', {
          metrics: {
            aiCalls: 1,
            tokensConsumed: 100,
            durationMs: 500,
            itemsFound: 2,
            itemsAccepted: 2,
            itemsRejected: 0,
          },
        }),
      ];
      const agent = new AnalyticsAgent(makeContext(stages));
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { lessonsLearned: { whatDidntWork: string[] } };
      expect(report.lessonsLearned.whatDidntWork).toHaveLength(0);
    });
  });

  describe('memoryBank persistence', () => {
    it('saves analyticsReport to memoryBank under "meta" category', async () => {
      const agent = new AnalyticsAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'meta',
        'analyticsReport',
        expect.stringContaining('"runId"'),
        'analytics',
      );
    });
  });

  describe('reviewItems', () => {
    it('always produces exactly 1 reviewItem (analytics-summary)', async () => {
      const agent = new AnalyticsAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      expect(reviewItems).toHaveLength(1);
      expect(reviewItems[0]!.id).toBe('analytics-summary');
    });
  });

  describe('error handling', () => {
    it('throws when currentRun is null', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: {
          present: {
            data: {
              title: 'Test',
              logline: '',
              manuscript: [],
              characters: { ids: [], entities: {} },
              worlds: { ids: [], entities: {} },
              outline: [],
            },
          },
        },
        proForge: { currentRun: null, runHistory: [] },
      } as unknown as ReturnType<OrchestratorContext['getState']>);

      const agent = new AnalyticsAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow(
        'No active pipeline run',
      );
    });
  });
});
