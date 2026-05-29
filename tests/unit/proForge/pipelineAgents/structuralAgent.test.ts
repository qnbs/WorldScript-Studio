/**
 * Tests for StructuralAgent — ProForge Pipeline Stage 2 (structural).
 * QNBS-v3: Mocks InferenceGateway (via context.gateway) + memoryBank; exercises happy path, fallback, pacing items, metrics.
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

const mockGenerate = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../services/ai/inferenceGateway', () => ({
  inferenceGateway: {
    generate: mockGenerate,
    embed: vi.fn(),
    modelList: vi.fn(),
    healthCheck: vi.fn(),
  },
}));

vi.mock('../../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: vi.fn(() => mockMemoryBank),
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../services/promptLibrary', () => ({
  getPrompt: vi.fn(() => 'mocked structural prompt'),
}));

vi.mock('../../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { logger } from '../../../../services/logger';
import { StructuralAgent } from '../../../../services/proForge/pipelineAgents/structuralAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gatewayResult(text: string) {
  return { text, model: 'gemini-2.5-flash', provider: 'gemini', isFallback: false };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['structural'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

const VALID_PLAN = {
  edits: [
    {
      id: 'se-1',
      sectionId: 's1',
      sectionTitle: 'Chapter 1',
      category: 'pacing',
      rationale: 'Scene drags before the climax',
      confidence: 0.9,
    },
  ],
  pacingReport: {
    sectionPacing: [
      {
        sectionId: 's1',
        sectionTitle: 'Chapter 1',
        tensionScore: 8,
        wordCount: 500,
        recommendedAction: 'compress',
      },
      {
        sectionId: 's2',
        sectionTitle: 'Chapter 2',
        tensionScore: 5,
        wordCount: 300,
        recommendedAction: 'keep',
      },
    ],
    overallPacing: 'moderate',
    suggestions: ['Tighten chapter 1'],
  },
  summary: 'Structural plan summary.',
};

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    projectId: 'proj-struct',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Structural Test',
            logline: 'A story',
            manuscript: [
              { id: 's1', title: 'Chapter 1', content: 'Alice entered the room slowly.' },
              { id: 's2', title: 'Chapter 2', content: 'Bob waited outside the door.' },
            ],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [],
          },
        },
      },
      proForge: {
        currentRun: null,
        isActive: false,
        activeView: 'dashboard',
        runHistory: [],
        isRunning: false,
        isLoading: false,
        error: null,
        defaultConfig: DEFAULT_CONFIG,
      },
      // biome-ignore lint/suspicious/noExplicitAny: partial test state
    } as any),
    manuscript: [],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
    gateway: { generate: mockGenerate, embed: vi.fn(), modelList: vi.fn(), healthCheck: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StructuralAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify(VALID_PLAN)));
    vi.mocked(mockMemoryBank.recall).mockResolvedValue([]);
  });

  describe('happy path', () => {
    it('returns reviewItems, metrics, and agentOutput on valid AI response', async () => {
      const agent = new StructuralAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(result.reviewItems).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.agentOutput).toBeDefined();
    });

    it('maps edits to reviewItems with type structuralEdit', async () => {
      const agent = new StructuralAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const editItems = reviewItems.filter((r) => r.type === 'structuralEdit');
      expect(editItems).toHaveLength(1);
      expect(editItems[0]!.id).toBe('struct-se-1');
    });

    it('adds pacingIssue items for sections where recommendedAction !== "keep"', async () => {
      const agent = new StructuralAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const pacingItems = reviewItems.filter((r) => r.type === 'pacingIssue');
      expect(pacingItems).toHaveLength(1);
      expect(pacingItems[0]!.id).toBe('struct-pacing-s1');
      expect(pacingItems[0]!.description).toContain('compress');
    });

    it('does NOT add pacingIssue for sections with recommendedAction "keep"', async () => {
      const agent = new StructuralAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const keepPacingItem = reviewItems.find((r) => r.id === 'struct-pacing-s2');
      expect(keepPacingItem).toBeUndefined();
    });

    it('records aiCalls=1 and tokensConsumed=response.length', async () => {
      const json = JSON.stringify(VALID_PLAN);
      mockGenerate.mockResolvedValue(gatewayResult(json));

      const agent = new StructuralAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
      expect(metrics.tokensConsumed).toBe(json.length);
    });

    it('calls memoryBank.buildContextString with "structural"', async () => {
      const agent = new StructuralAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.buildContextString).toHaveBeenCalledWith('structural', undefined, 3000);
    });

    it('calls memoryBank.recall("meta") to retrieve diagnostic report', async () => {
      const agent = new StructuralAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.recall).toHaveBeenCalledWith('meta');
    });

    it('saves structuralPlan to memoryBank under category "edit"', async () => {
      const agent = new StructuralAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'edit',
        'structuralPlan',
        expect.stringContaining('"edits"'),
        'structural',
      );
    });

    it('uses diagnosticReport content from memoryBank when available', async () => {
      const { getPrompt } = await import('../../../../services/promptLibrary');
      vi.mocked(mockMemoryBank.recall).mockResolvedValue([
        {
          key: 'diagnosticReport',
          content: '{"summary":"prior diag"}',
          category: 'meta',
          id: '1',
          projectId: 'proj-struct',
          sourceStage: 'intake',
          createdAt: '',
        },
      ]);

      const agent = new StructuralAgent(makeContext());
      await agent.execute(new AbortController().signal);

      const promptArgs = vi.mocked(getPrompt).mock.calls[0]![1];
      expect(promptArgs?.['diagnosticSummary']).toContain('prior diag');
    });
  });

  describe('fallback behaviour', () => {
    it('uses fallback plan when AI returns invalid JSON', async () => {
      mockGenerate.mockResolvedValue(gatewayResult('{ not valid json '));

      const agent = new StructuralAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const plan = agentOutput as { edits: unknown[] };
      expect(plan.edits).toHaveLength(0);
    });

    it('uses fallback plan when schema validation fails', async () => {
      mockGenerate.mockResolvedValue(
        gatewayResult(JSON.stringify({ edits: 'not-an-array', pacingReport: {}, summary: 'bad' })),
      );

      const agent = new StructuralAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
      expect((result.agentOutput as { edits: unknown[] }).edits).toHaveLength(0);
    });

    it('uses fallback plan when AI call throws', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const agent = new StructuralAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.error)).toHaveBeenCalled();
      expect((result.agentOutput as { edits: unknown[] }).edits).toHaveLength(0);
    });

    it('fallback plan creates pacing entry per manuscript section', async () => {
      mockGenerate.mockRejectedValue(new Error('fail'));

      const agent = new StructuralAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const plan = agentOutput as { pacingReport: { sectionPacing: unknown[] } };
      // Two sections in the mock context
      expect(plan.pacingReport.sectionPacing).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('throws when project data is unavailable', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: { present: null },
        proForge: { currentRun: null },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
      } as any);

      const agent = new StructuralAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });
  });
});
