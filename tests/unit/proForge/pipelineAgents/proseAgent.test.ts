/**
 * Tests for ProseAgent — ProForge Pipeline Stage 3 (lineProse).
 * QNBS-v3: Tests section-loop, filter-word detection, deduplication, fallback, metrics.
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
  getPrompt: vi.fn(() => 'mocked prose prompt'),
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
import { ProseAgent } from '../../../../services/proForge/pipelineAgents/proseAgent';
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
  genrePreset: 'literary-fiction',
  selectedStages: ['lineProse'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

/** Generates content ≥ 50 words so the agent processes the section. */
function longContent(prefix = '') {
  // QNBS-v3: 9 words × 6 = 54 words, which is above the 50-word skip threshold in ProseAgent.
  return `${prefix}${'The quick brown fox jumps over the lazy dog. '.repeat(6)}`;
}

function makeBatchResponse(sectionId: string) {
  return JSON.stringify({
    edits: [
      {
        id: `pe-${sectionId}-1`,
        sectionId,
        startOffset: 0,
        endOffset: 10,
        category: 'showDontTell',
        original: 'He felt sad',
        proposed: 'His shoulders slumped',
        rationale: 'Show emotion through action',
        confidence: 0.88,
      },
    ],
    beforeMetrics: {
      adverbDensity: 2,
      filterWordDensity: 1,
      dialogueRatio: 20,
      sensoryScore: 55,
      showDontTellScore: 60,
      povConsistencyScore: 75,
    },
    summary: 'Prose edits for section.',
  });
}

function makeContext(
  sections = [{ id: 's1', title: 'Ch 1', content: longContent() }],
): OrchestratorContext {
  return {
    projectId: 'proj-prose',
    dispatch: vi.fn() as unknown as OrchestratorContext['dispatch'],
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Prose Test',
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
    } as unknown as ReturnType<OrchestratorContext['getState']>),
    manuscript: [],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
    gateway: { generate: mockGenerate, embed: vi.fn(), modelList: vi.fn(), healthCheck: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProseAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(gatewayResult(makeBatchResponse('s1')));
  });

  describe('section loop', () => {
    it('calls generateText once per qualifying section', async () => {
      const ctx = makeContext([
        { id: 's1', title: 'Ch 1', content: longContent() },
        { id: 's2', title: 'Ch 2', content: longContent() },
      ]);
      mockGenerate
        .mockResolvedValueOnce(gatewayResult(makeBatchResponse('s1')))
        .mockResolvedValueOnce(gatewayResult(makeBatchResponse('s2')));

      const agent = new ProseAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(mockGenerate).toHaveBeenCalledTimes(2);
    });

    it('skips sections with fewer than 50 words', async () => {
      const ctx = makeContext([{ id: 's1', title: 'Short', content: 'Only a few words here.' }]);

      const agent = new ProseAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('processes at most 5 sections', async () => {
      const sections = Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch ${i}`,
        content: longContent(`Section ${i} `),
      }));
      mockGenerate.mockResolvedValue(gatewayResult(makeBatchResponse('s0')));

      const ctx = makeContext(sections);
      const agent = new ProseAgent(ctx);
      await agent.execute(new AbortController().signal);

      expect(mockGenerate).toHaveBeenCalledTimes(5);
    });

    // QNBS-v3: PR7 — abort during the cooperative yield stops before the next AI call. Counting
    // getter: the top-of-loop check passes, the post-yield check reports aborted.
    it('re-checks abort after the cooperative yield (no extra AI call)', async () => {
      const ac = new AbortController();
      let reads = 0;
      Object.defineProperty(ac.signal, 'aborted', {
        configurable: true,
        get() {
          reads += 1;
          return reads >= 2;
        },
      });
      const ctx = makeContext([{ id: 's1', title: 'Ch 1', content: longContent() }]);
      const agent = new ProseAgent(ctx);
      // QNBS-v3: PR7 — an aborted run throws (explicit cancellation), not a silent empty success.
      await expect(agent.execute(ac.signal)).rejects.toThrow('Stage aborted');

      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('continues processing other sections when one AI call fails', async () => {
      const ctx = makeContext([
        { id: 's1', title: 'Ch 1', content: longContent() },
        { id: 's2', title: 'Ch 2', content: longContent() },
      ]);
      mockGenerate
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(gatewayResult(makeBatchResponse('s2')));

      const agent = new ProseAgent(ctx);
      const result = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
      // s2 edits should still be in the result
      expect(result.metrics.aiCalls).toBe(1);
    });

    it('stops processing further sections when signal is aborted', async () => {
      const ac = new AbortController();
      const sections = Array.from({ length: 3 }, (_, i) => ({
        id: `s${i}`,
        title: `Ch ${i}`,
        content: longContent(),
      }));
      // Abort after first call
      mockGenerate.mockImplementation(async () => {
        ac.abort();
        return gatewayResult(makeBatchResponse('s0'));
      });

      const ctx = makeContext(sections);
      const agent = new ProseAgent(ctx);
      // QNBS-v3: PR7 — aborted run throws rather than returning a silent empty result.
      await expect(agent.execute(ac.signal)).rejects.toThrow('Stage aborted');

      // Only 1 section processed before abort check kicked in
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe('filter word detection', () => {
    it('detects filter words in manuscript content', async () => {
      const ctx = makeContext([
        {
          id: 's1',
          title: 'Ch 1',
          content:
            'She just walked very slowly down the road. It was quite a sight. ' +
            'The quick brown fox jumps over the lazy dog. '.repeat(5),
        },
      ]);

      const agent = new ProseAgent(ctx);
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const filterItems = reviewItems.filter((r) => r.description?.includes('[filterWord]'));
      expect(filterItems.length).toBeGreaterThan(0);
    });

    it('does not add filter word edits when content has no filter words', async () => {
      const ctx = makeContext([
        { id: 's1', title: 'Ch 1', content: longContent('The fox ran fast down the road. ') },
      ]);

      const agent = new ProseAgent(ctx);
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const filterItems = reviewItems.filter((r) => r.description?.includes('[filterWord]'));
      expect(filterItems.length).toBe(0);
    });
  });

  describe('deduplication', () => {
    it('deduplicates edits with the same sectionId + offset range', async () => {
      // Return two edits with the same offset from AI
      const responseWithDup = JSON.stringify({
        edits: [
          {
            id: 'dup-1',
            sectionId: 's1',
            startOffset: 0,
            endOffset: 10,
            category: 'adverb',
            original: 'quickly',
            proposed: '',
            rationale: 'Adverb',
            confidence: 0.8,
          },
          {
            id: 'dup-2',
            sectionId: 's1',
            startOffset: 0,
            endOffset: 10,
            category: 'adverb',
            original: 'quickly',
            proposed: '',
            rationale: 'Duplicate',
            confidence: 0.7,
          },
        ],
        beforeMetrics: {
          adverbDensity: 3,
          filterWordDensity: 0,
          dialogueRatio: 0,
          sensoryScore: 50,
          showDontTellScore: 50,
          povConsistencyScore: 70,
        },
        summary: 'Dup test',
      });
      mockGenerate.mockResolvedValue(gatewayResult(responseWithDup));

      const agent = new ProseAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const output = agentOutput as {
        edits: Array<{ startOffset: number; endOffset: number; sectionId: string }>;
      };
      // Two identical offsets should be deduped to 1
      const offsetZeroEdits = output.edits.filter(
        (e) => e.startOffset === 0 && e.endOffset === 10 && e.sectionId === 's1',
      );
      expect(offsetZeroEdits).toHaveLength(1);
    });
  });

  describe('metrics', () => {
    it('aiCalls equals the number of sections that were processed', async () => {
      const agent = new ProseAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
    });

    it('agentOutput.beforeMetrics.filterWordDensity is non-negative', async () => {
      const agent = new ProseAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const bm = (agentOutput as { beforeMetrics: { filterWordDensity: number } }).beforeMetrics;
      expect(bm.filterWordDensity).toBeGreaterThanOrEqual(0);
    });

    it('saves proseEdits to memoryBank under "edit" category', async () => {
      const agent = new ProseAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'edit',
        'proseEdits',
        expect.any(String),
        'lineProse',
      );
    });
  });

  describe('error handling', () => {
    it('throws when project data is unavailable', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: { present: null },
        proForge: { currentRun: null },
      } as unknown as ReturnType<OrchestratorContext['getState']>);

      const agent = new ProseAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });

    it('returns empty edits when all sections are short (< 50 words) and no filter words', async () => {
      const ctx = makeContext([{ id: 's1', title: 'Tiny', content: 'Short text.' }]);

      const agent = new ProseAgent(ctx);
      const { agentOutput } = await agent.execute(new AbortController().signal);

      expect((agentOutput as { edits: unknown[] }).edits).toHaveLength(0);
    });
  });
});
