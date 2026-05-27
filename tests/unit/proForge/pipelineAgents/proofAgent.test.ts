/**
 * Tests for ProofAgent — ProForge Pipeline Stage 5 (proof).
 * QNBS-v3: Mocks aiProviderService + memoryBank; exercises quality gate, fallback, truncation, "Focused" creativity.
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

vi.mock('../../../../services/aiProviderService', () => ({
  aiProviderService: { generateText: vi.fn() },
}));

vi.mock('../../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: vi.fn(() => mockMemoryBank),
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../services/promptLibrary', () => ({
  getPrompt: vi.fn(() => 'mocked proof prompt'),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { aiProviderService } from '../../../../services/aiProviderService';
import { logger } from '../../../../services/logger';
import { ProofAgent } from '../../../../services/proForge/pipelineAgents/proofAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['proof'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Imaginative', // should be overridden to 'Focused'
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

const VALID_REPORT = {
  overallPass: true,
  grammar: {
    pass: true,
    score: 88,
    issues: [
      {
        id: 'ge-1',
        sectionId: 's1',
        startOffset: 0,
        endOffset: 5,
        ruleId: 'COMMA_SPLICE',
        ruleName: 'Comma Splice',
        original: 'run, go',
        proposed: 'run; go',
        explanation: 'Two independent clauses joined with comma',
      },
    ],
  },
  style: { pass: true, score: 85, issues: [] },
  technical: {
    pass: true,
    score: 90,
    issues: [{ id: 'ti-1', issue: 'Missing chapter headers in section 2' }],
  },
  legal: {
    pass: true,
    score: 100,
    warnings: [
      {
        id: 'lw-1',
        type: 'trademark',
        description: 'Brand name used without disclaimer',
        affectedText: 'Nike shoes',
        sectionId: 's1',
        severity: 'warning',
        recommendation: 'Add trademark disclaimer',
      },
    ],
  },
  readability: {
    pass: true,
    score: 82,
    metrics: {
      fleschKincaid: 8,
      fleschReadingEase: 62,
      targetAgeMin: 14,
      targetAgeMax: 99,
      appropriateForGenre: true,
    },
  },
  summary: 'Quality gate passed.',
};

function makeContext(
  manuscript = [{ id: 's1', title: 'Ch 1', content: 'Alice walked into the room slowly.' }],
): OrchestratorContext {
  return {
    projectId: 'proj-proof',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Proof Test',
            logline: '',
            manuscript,
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProofAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProviderService.generateText).mockResolvedValue(JSON.stringify(VALID_REPORT));
  });

  describe('happy path', () => {
    it('returns reviewItems, metrics, and agentOutput on valid AI response', async () => {
      const agent = new ProofAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(result.reviewItems).toBeDefined();
      expect(result.agentOutput).toBeDefined();
      expect(result.metrics.aiCalls).toBe(1);
    });

    it('always prepends a proof-overall item as first reviewItem', async () => {
      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      expect(reviewItems[0]!.id).toBe('proof-overall');
      expect(reviewItems[0]!.description).toContain('PASSED');
    });

    it('proof-overall item severity is "info" when overallPass=true', async () => {
      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      expect(reviewItems[0]!.severity).toBe('info');
    });

    it('proof-overall item severity is "critical" when overallPass=false', async () => {
      vi.mocked(aiProviderService.generateText).mockResolvedValue(
        JSON.stringify({ ...VALID_REPORT, overallPass: false }),
      );

      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      expect(reviewItems[0]!.severity).toBe('critical');
    });

    it('maps grammar issues to reviewItems with type grammarEdit', async () => {
      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const grammarItems = reviewItems.filter((r) => r.type === 'grammarEdit');
      expect(grammarItems).toHaveLength(1);
      expect(grammarItems[0]!.id).toBe('proof-g-0');
    });

    it('maps legal warnings to reviewItems with type legalWarning', async () => {
      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const legalItems = reviewItems.filter((r) => r.type === 'legalWarning');
      expect(legalItems).toHaveLength(1);
      expect(legalItems[0]!.description).toContain('TRADEMARK');
    });

    it('maps technical issues to reviewItems with type technicalIssue', async () => {
      const agent = new ProofAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const techItems = reviewItems.filter((r) => r.type === 'technicalIssue');
      expect(techItems).toHaveLength(1);
    });

    it('always calls AI with creativity "Focused" regardless of config.creativity', async () => {
      const agent = new ProofAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(aiProviderService.generateText)).toHaveBeenCalledWith(
        expect.any(String),
        'Focused',
        expect.any(Object),
      );
    });

    it('saves qualityGate report to memoryBank under "feedback" category', async () => {
      const agent = new ProofAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'feedback',
        'qualityGate',
        expect.stringContaining('"overallPass"'),
        'proof',
      );
    });
  });

  describe('manuscript truncation', () => {
    it('truncates manuscript to 12000 characters when passed to prompt', async () => {
      const { getPrompt } = await import('../../../../services/promptLibrary');
      const longManuscript = [
        { id: 's1', title: 'Long Chapter', content: 'word '.repeat(5000) }, // ~25000 chars
      ];

      const agent = new ProofAgent(makeContext(longManuscript));
      await agent.execute(new AbortController().signal);

      const promptCall = vi.mocked(getPrompt).mock.calls[0]!;
      const manuscriptArg = promptCall[1]?.['manuscript'] ?? '';
      expect(manuscriptArg.length).toBeLessThanOrEqual(12000);
    });
  });

  describe('fallback behaviour', () => {
    it('returns fallback report (overallPass=false, isFallback=true) when AI call fails', async () => {
      vi.mocked(aiProviderService.generateText).mockRejectedValue(new Error('AI error'));

      const agent = new ProofAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      // P-4: honest fallback — not a fake pass
      expect((agentOutput as { overallPass: boolean }).overallPass).toBe(false);
      expect((agentOutput as { isFallback: boolean }).isFallback).toBe(true);
      expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });

    it('returns fallback report when schema validation fails', async () => {
      vi.mocked(aiProviderService.generateText).mockResolvedValue(
        JSON.stringify({ invalid: 'data' }),
      );

      const agent = new ProofAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const report = agentOutput as { grammar: { score: number }; isFallback: boolean };
      // P-4: score is 0 (honest), not a fake plausible value
      expect(report.grammar.score).toBe(0);
      expect(report.isFallback).toBe(true);
      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });

    it('fallback report summary describes the failure', async () => {
      vi.mocked(aiProviderService.generateText).mockRejectedValue(new Error('fail'));

      const agent = new ProofAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      // P-4: honest summary — no fake "manual review" framing
      expect((agentOutput as { summary: string }).summary).toContain('Quality gate could not run');
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

      const agent = new ProofAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });
  });
});
