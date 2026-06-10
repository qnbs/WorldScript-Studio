/**
 * Tests for DiagnosticAgent — ProForge Pipeline Stage 1 (intake).
 * QNBS-v3: Mocks InferenceGateway (via context.gateway) + memoryBank + promptLibrary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock objects (available inside vi.mock() factories)
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

vi.mock('../../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: vi.fn(() => mockMemoryBank),
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../services/promptLibrary', () => ({
  getPrompt: vi.fn(() => 'mocked diagnostic prompt'),
}));

// QNBS-v3: BaseAgent.generate() routes through this.gateway.generate() (InferenceGateway),
// not aiProviderService.generateText directly — mock the gateway, not the service.
vi.mock('../../../../services/ai/inferenceGateway', () => ({
  inferenceGateway: {
    generate: mockGenerate,
    embed: vi.fn(),
    modelList: vi.fn(),
    healthCheck: vi.fn(),
  },
}));

vi.mock('../../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { logger } from '../../../../services/logger';
import { DiagnosticAgent } from '../../../../services/proForge/pipelineAgents/diagnosticAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Helper — gateway result wrapper
// ---------------------------------------------------------------------------

function gatewayResult(text: string) {
  return { text, model: 'gemini-2.5-flash', provider: 'gemini', isFallback: false };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['intake'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

const VALID_REPORT = {
  profile: {
    wordCount: 6,
    sectionCount: 1,
    averageSectionLength: 6,
    detectedGenre: 'literary-fiction',
    pacingEstimate: 'moderate',
  },
  consistencyIssues: [
    {
      id: 'ci-1',
      type: 'character',
      severity: 'warning',
      entityName: 'Alice',
      description: 'Hair color inconsistent across chapters',
      sectionIds: ['s1'],
    },
  ],
  structuralGaps: [
    {
      id: 'sg-1',
      type: 'unresolvedThread',
      description: 'Antagonist motivation not established',
      affectedSectionIds: ['s1'],
      suggestion: 'Add backstory in chapter 2',
    },
  ],
  qualityScore: {
    overall: 72,
    prose: 70,
    structure: 75,
    consistency: 68,
    pacing: 73,
    dialogue: 71,
    marketability: 77,
  },
  summary: 'Test diagnostic summary.',
};

function makeSection(id = 's1', content = 'Alice walked into the room.') {
  return { id, title: `Chapter ${id}`, content, status: 'draft' as const, act: 1 };
}

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    projectId: 'proj-test',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Test Novel',
            logline: 'A hero journey',
            manuscript: [makeSection()],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [{ title: 'Act 1', description: 'Setup' }],
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

describe('DiagnosticAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify(VALID_REPORT)));
  });

  describe('happy path', () => {
    it('returns reviewItems, metrics, and agentOutput on valid AI response', async () => {
      const agent = new DiagnosticAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(result.reviewItems).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.agentOutput).toBeDefined();
    });

    it('maps consistencyIssues to reviewItems with type consistencyIssue', async () => {
      const agent = new DiagnosticAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const consistencyItems = reviewItems.filter((r) => r.id.startsWith('diag-consistency-'));
      expect(consistencyItems).toHaveLength(1);
      expect(consistencyItems[0]!.type).toBe('consistencyIssue');
      expect(consistencyItems[0]!.severity).toBe('warning');
    });

    it('maps structuralGaps to reviewItems with type plotHole', async () => {
      const agent = new DiagnosticAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const gapItems = reviewItems.filter((r) => r.id.startsWith('diag-structural-'));
      expect(gapItems).toHaveLength(1);
      expect(gapItems[0]!.type).toBe('plotHole');
      expect(gapItems[0]!.severity).toBe('warning');
    });

    it('always appends a quality score info item', async () => {
      const agent = new DiagnosticAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const qualityItem = reviewItems.find((r) => r.id === 'diag-quality-score');
      expect(qualityItem).toBeDefined();
      expect(qualityItem?.severity).toBe('info');
      expect(qualityItem?.description).toContain('72');
    });

    it('records aiCalls=1 and tokensConsumed=response.length in metrics', async () => {
      const responseJson = JSON.stringify(VALID_REPORT);
      mockGenerate.mockResolvedValue(gatewayResult(responseJson));

      const agent = new DiagnosticAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
      expect(metrics.tokensConsumed).toBe(responseJson.length);
    });

    it('sets itemsFound to total number of reviewItems', async () => {
      const agent = new DiagnosticAgent(makeContext());
      const { reviewItems, metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.itemsFound).toBe(reviewItems.length);
    });

    it('calls memoryBank.buildContextString with stage "intake"', async () => {
      const agent = new DiagnosticAgent(makeContext());
      await agent.execute(new AbortController().signal);

      // QNBS-v3: story-anchored query + the run's ragMode are threaded so semantic/hybrid recall is honoured.
      expect(mockMemoryBank.buildContextString).toHaveBeenCalledWith(
        'intake',
        expect.stringContaining('Test Novel'),
        3000,
        'hybrid',
      );
    });

    it('saves diagnosticReport to memoryBank under category "meta"', async () => {
      const agent = new DiagnosticAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'meta',
        'diagnosticReport',
        expect.stringContaining('"qualityScore"'),
        'intake',
      );
    });

    it('handles AI response wrapped in ```json code fences', async () => {
      mockGenerate.mockResolvedValue(
        gatewayResult(`\`\`\`json\n${JSON.stringify(VALID_REPORT)}\n\`\`\``),
      );
      const agent = new DiagnosticAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect((result.agentOutput as typeof VALID_REPORT).qualityScore.overall).toBe(72);
    });
  });

  describe('fallback behaviour', () => {
    it('uses fallback report when AI returns invalid JSON', async () => {
      mockGenerate.mockResolvedValue(gatewayResult('not json at all'));

      const agent = new DiagnosticAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      // P-4: Fallback reports are honest — overall is 0, not a fake 50
      const report = result.agentOutput as {
        qualityScore: { overall: number };
        isFallback: boolean;
      };
      expect(report.qualityScore.overall).toBe(0);
      expect(report.isFallback).toBe(true);
    });

    it('uses fallback report when schema validation fails', async () => {
      mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify({ invalid: 'structure' })));

      const agent = new DiagnosticAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
      const report = result.agentOutput as {
        qualityScore: { overall: number };
        isFallback: boolean;
      };
      expect(report.qualityScore.overall).toBe(0);
      expect(report.isFallback).toBe(true);
    });

    it('uses fallback report when aiProviderService.generateText throws', async () => {
      mockGenerate.mockRejectedValue(new Error('Network error'));

      const agent = new DiagnosticAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.error)).toHaveBeenCalled();
      const report = result.agentOutput as {
        qualityScore: { overall: number };
        isFallback: boolean;
      };
      expect(report.qualityScore.overall).toBe(0);
      expect(report.isFallback).toBe(true);
    });

    it('fallback report summary contains the project title', async () => {
      mockGenerate.mockRejectedValue(new Error('fail'));

      const agent = new DiagnosticAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      expect((agentOutput as { summary: string }).summary).toContain('Test Novel');
    });

    it('fallback report reflects actual word count from manuscript', async () => {
      mockGenerate.mockRejectedValue(new Error('fail'));
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: {
          present: {
            data: {
              title: 'Test',
              logline: '',
              manuscript: [makeSection('s1', 'one two three four five')],
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
      } as any);

      const agent = new DiagnosticAgent(ctx);
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const profile = (agentOutput as { profile: { wordCount: number } }).profile;
      expect(profile.wordCount).toBe(5);
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

      const agent = new DiagnosticAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });

    it('uses fallback report when signal is aborted after AI call (abort caught by inner try-catch)', async () => {
      const ac = new AbortController();
      // Abort synchronously inside gateway so signal.aborted=true when the check runs
      mockGenerate.mockImplementation(async () => {
        ac.abort();
        return gatewayResult(JSON.stringify(VALID_REPORT));
      });

      const agent = new DiagnosticAgent(makeContext());
      // QNBS-v3: abort is caught by inner catch → fallback report returned (not thrown to caller)
      const result = await agent.execute(ac.signal);
      const report = result.agentOutput as {
        qualityScore: { overall: number };
        isFallback: boolean;
      };
      expect(report.qualityScore.overall).toBe(0);
      expect(report.isFallback).toBe(true);
      expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });
  });

  describe('P-3: self-evaluation loop', () => {
    // Helper: context with a manuscript large enough to trigger self-evaluation (>500 words)
    function makeLargeContext() {
      const bigContent = Array.from({ length: 60 }, (_, i) => `Word${i}`).join(' '); // 60 words
      const tenSections = Array.from({ length: 10 }, (_, i) => makeSection(`s${i}`, bigContent));
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: {
          present: {
            data: {
              title: 'Big Novel',
              logline: '',
              manuscript: tenSections, // 600 words > 500 threshold
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
      } as any);
      return ctx;
    }

    it('makes a second AI call (reflection) when totalWords > 500 and primary succeeds', async () => {
      const reportJson = JSON.stringify(VALID_REPORT);
      mockGenerate
        .mockResolvedValueOnce(gatewayResult(reportJson)) // primary
        .mockResolvedValueOnce(gatewayResult('COHERENT: looks grounded')); // reflection

      const agent = new DiagnosticAgent(makeLargeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      // primary (1) + reflection (2)
      expect(metrics.aiCalls).toBe(2);
    });

    it('sets reflectionNotes on the report when self-eval runs', async () => {
      mockGenerate
        .mockResolvedValueOnce(gatewayResult(JSON.stringify(VALID_REPORT)))
        .mockResolvedValueOnce(gatewayResult('COHERENT: well grounded'));

      const agent = new DiagnosticAgent(makeLargeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      expect((agentOutput as { reflectionNotes?: string }).reflectionNotes).toContain('COHERENT');
    });

    it('retries primary call when reflection returns INCOHERENT', async () => {
      const reportJson = JSON.stringify(VALID_REPORT);
      mockGenerate
        .mockResolvedValueOnce(gatewayResult(reportJson)) // primary
        .mockResolvedValueOnce(gatewayResult('INCOHERENT: hallucinated')) // reflection
        .mockResolvedValueOnce(gatewayResult(reportJson)); // retry primary

      const agent = new DiagnosticAgent(makeLargeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      // primary (1) + reflection (2) + retry primary (3)
      expect(metrics.aiCalls).toBe(3);
    });

    it('does not trigger self-eval when totalWords <= 500', async () => {
      // Default makeContext has 5-word manuscript → no self-eval
      mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify(VALID_REPORT)));

      const agent = new DiagnosticAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
    });

    it('does not trigger self-eval on fallback reports', async () => {
      // gateway rejects → aiCalls never incremented (throw before += 1)
      mockGenerate.mockRejectedValue(new Error('fail'));

      const agent = new DiagnosticAgent(makeLargeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty manuscript (0 sections) without throwing', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: {
          present: {
            data: {
              title: 'Empty',
              logline: '',
              manuscript: [],
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
      } as any);
      mockGenerate.mockRejectedValue(new Error('fail'));

      const agent = new DiagnosticAgent(ctx);
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const profile = (agentOutput as { profile: { wordCount: number; sectionCount: number } })
        .profile;
      expect(profile.wordCount).toBe(0);
      expect(profile.sectionCount).toBe(0);
    });

    it('manuscript excerpt uses only first 3 sections', async () => {
      const { getPrompt } = await import('../../../../services/promptLibrary');
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: {
          present: {
            data: {
              title: 'Big Novel',
              logline: '',
              manuscript: Array.from({ length: 10 }, (_, i) =>
                makeSection(`s${i}`, `Content of section ${i}`),
              ),
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
      } as any);

      const agent = new DiagnosticAgent(ctx);
      await agent.execute(new AbortController().signal);

      // manuscriptExcerpt arg should only contain content from first 3 sections
      const call = vi.mocked(getPrompt).mock.calls[0]!;
      expect(call[0]).toBe('diagnosticReport');
      expect(call[1]?.['manuscriptExcerpt']).not.toContain('Content of section 4');
    });
  });
});
