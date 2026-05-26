/**
 * Tests for CopyEditAgent — ProForge Pipeline Stage 4 (copyEdit).
 * QNBS-v3: Tests grammar/style edits, repetition detection (client-side), deduplication, section loop.
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
  getPrompt: vi.fn(() => 'mocked copy edit prompt'),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { aiProviderService } from '../../../../services/aiProviderService';
import { logger } from '../../../../services/logger';
import { CopyEditAgent } from '../../../../services/proForge/pipelineAgents/copyEditAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['copyEdit'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

/** Content with 54 words (above the 50-word minimum). */
function longContent(prefix = '') {
  return `${prefix}${'The quick brown fox jumps over the lazy dog. '.repeat(6)}`;
}

function makeCopyEditResponse(sectionId: string) {
  return JSON.stringify({
    grammarEdits: [
      {
        id: `ge-${sectionId}`,
        sectionId,
        startOffset: 0,
        endOffset: 5,
        ruleId: 'COMMA_SPLICE',
        ruleName: 'Comma Splice',
        original: 'run, go',
        proposed: 'run; go',
        explanation: 'Two independent clauses joined with a comma',
      },
    ],
    styleEdits: [
      {
        id: `se-${sectionId}`,
        sectionId,
        startOffset: 10,
        endOffset: 20,
        category: 'redundancy',
        original: 'end result',
        proposed: 'result',
        rationale: 'Redundant phrase',
      },
    ],
    repetitionHits: [],
    formatIssues: [],
    summary: 'Copy edit done.',
  });
}

function makeContext(
  sections = [{ id: 's1', title: 'Ch 1', content: longContent() }],
): OrchestratorContext {
  return {
    projectId: 'proj-copy',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Copy Test',
            logline: '',
            manuscript: sections,
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

describe('CopyEditAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProviderService.generateText).mockResolvedValue(makeCopyEditResponse('s1'));
  });

  describe('section loop', () => {
    it('processes qualifying sections and returns grammar/style review items', async () => {
      const agent = new CopyEditAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const grammarItems = reviewItems.filter((r) => r.type === 'grammarEdit');
      const styleItems = reviewItems.filter((r) => r.type === 'styleEdit');
      expect(grammarItems).toHaveLength(1);
      expect(styleItems).toHaveLength(1);
    });

    it('processes at most 3 sections', async () => {
      const sections = Array.from({ length: 5 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch ${i}`,
        content: longContent(),
      }));
      vi.mocked(aiProviderService.generateText).mockResolvedValue(makeCopyEditResponse('s0'));

      const ctx = makeContext(sections);
      const agent = new CopyEditAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(aiProviderService.generateText)).toHaveBeenCalledTimes(3);
    });

    it('skips sections with fewer than 50 words', async () => {
      const ctx = makeContext([{ id: 's1', title: 'Short', content: 'Only a few words.' }]);
      const agent = new CopyEditAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(aiProviderService.generateText)).not.toHaveBeenCalled();
    });

    it('continues processing other sections when one AI call fails', async () => {
      const ctx = makeContext([
        { id: 's1', title: 'Ch 1', content: longContent() },
        { id: 's2', title: 'Ch 2', content: longContent() },
      ]);
      vi.mocked(aiProviderService.generateText)
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(makeCopyEditResponse('s2'));

      const agent = new CopyEditAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });

    it('stops processing further sections when signal is aborted', async () => {
      const ac = new AbortController();
      const sections = Array.from({ length: 3 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch ${i}`,
        content: longContent(),
      }));
      vi.mocked(aiProviderService.generateText).mockImplementation(async () => {
        ac.abort();
        return makeCopyEditResponse('s0');
      });

      const ctx = makeContext(sections);
      const agent = new CopyEditAgent(ctx);
      await agent.execute(ac.signal);

      expect(vi.mocked(aiProviderService.generateText)).toHaveBeenCalledTimes(1);
    });
  });

  describe('client-side repetition detection', () => {
    it('flags words appearing 5+ times as repetitionHit review items', async () => {
      // "dragon" × 6 should be flagged; stop words ("the") should not
      const repeatedContent = 'dragon dragon dragon dragon dragon dragon the the the the the the';
      const ctx = makeContext([{ id: 's1', title: 'Ch 1', content: repeatedContent }]);

      const agent = new CopyEditAgent(ctx);
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const repetitionItems = reviewItems.filter((r) => r.type === 'repetitionHit');
      expect(repetitionItems.length).toBeGreaterThan(0);
      expect(repetitionItems.some((r) => r.description?.includes('dragon'))).toBe(true);
    });

    it('does not flag stop words as repetitions', async () => {
      // "the" appears many times but is a stop word
      const content = 'the the the the the the dragon walked through the forest';
      const ctx = makeContext([{ id: 's1', title: 'Ch 1', content }]);

      const agent = new CopyEditAgent(ctx);
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const theRepetition = reviewItems.find(
        (r) => r.type === 'repetitionHit' && r.description?.includes('"the"'),
      );
      expect(theRepetition).toBeUndefined();
    });

    it('does not flag words appearing fewer than 5 times', async () => {
      // "hero" appears only 4 times — below the threshold
      const content = 'hero hero hero hero walked down the long long long long road';
      const ctx = makeContext([{ id: 's1', title: 'Ch 1', content }]);

      const agent = new CopyEditAgent(ctx);
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const heroRep = reviewItems.find(
        (r) => r.type === 'repetitionHit' && r.description?.includes('"hero"'),
      );
      expect(heroRep).toBeUndefined();
    });
  });

  describe('deduplication', () => {
    it('removes grammar edits with the same sectionId + offset range', async () => {
      const dupResponse = JSON.stringify({
        grammarEdits: [
          {
            id: 'ge-a',
            sectionId: 's1',
            startOffset: 0,
            endOffset: 5,
            ruleId: 'RULE_1',
            ruleName: 'Rule 1',
            original: 'foo',
            proposed: 'bar',
            explanation: 'First',
          },
          {
            id: 'ge-b',
            sectionId: 's1',
            startOffset: 0,
            endOffset: 5,
            ruleId: 'RULE_2',
            ruleName: 'Rule 2',
            original: 'foo',
            proposed: 'baz',
            explanation: 'Duplicate range',
          },
        ],
        styleEdits: [],
        repetitionHits: [],
        formatIssues: [],
        summary: 'Dup test',
      });
      vi.mocked(aiProviderService.generateText).mockResolvedValue(dupResponse);

      const agent = new CopyEditAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const plan = agentOutput as { grammarEdits: unknown[] };
      expect(plan.grammarEdits).toHaveLength(1);
    });
  });

  describe('metrics and persistence', () => {
    it('records aiCalls equal to the number of qualifying sections processed', async () => {
      const agent = new CopyEditAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
    });

    it('saves copyEditPlan to memoryBank under "edit" category', async () => {
      const agent = new CopyEditAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'edit',
        'copyEditPlan',
        expect.stringContaining('"grammarEdits"'),
        'copyEdit',
      );
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

      const agent = new CopyEditAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });
  });
});
