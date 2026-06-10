/**
 * Tests for BaseAgent — shared scaffolding for all ProForge pipeline agents.
 * QNBS-v3: Tests abstract class via concrete subclass; mocks InferenceGateway and logger.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGenerate = vi.hoisted(() => vi.fn());
const mockGetMemoryBank = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/ai/inferenceGateway', () => ({
  inferenceGateway: { generate: mockGenerate, embed: vi.fn(), modelList: vi.fn() },
}));

vi.mock('../../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: mockGetMemoryBank,
}));

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig, StageResult } from '../../../../features/proForge/types';
import { logger } from '../../../../services/logger';
import { BaseAgent } from '../../../../services/proForge/pipelineAgents/baseAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Concrete stub — BaseAgent is abstract
// ---------------------------------------------------------------------------

class StubAgent extends BaseAgent {
  async execute(
    _signal: AbortSignal,
  ): Promise<Pick<StageResult, 'reviewItems' | 'metrics' | 'agentOutput'>> {
    return {
      reviewItems: [],
      metrics: {
        durationMs: 0,
        tokensConsumed: 0,
        aiCalls: 0,
        itemsFound: 0,
        itemsAccepted: 0,
        itemsRejected: 0,
      },
      agentOutput: undefined,
    };
  }

  // Expose protected methods for testing
  publicRequireProject() {
    return this.requireProject();
  }
  publicGetMemoryBank() {
    return this.getMemoryBank();
  }
  publicElapsed(startTime: number) {
    return this.elapsed(startTime);
  }
  async publicGenerate(prompt: string, maxTokens?: number) {
    return this.generate(prompt, maxTokens);
  }
  publicBuildAiOpts(overrides?: { maxTokens?: number; signal?: AbortSignal }) {
    return this.buildAiOpts(overrides);
  }
  async publicSelfReflect(excerpt: string, summary: string, signal: AbortSignal) {
    return this.selfReflect(excerpt, summary, signal);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
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

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  const mockGateway = {
    generate: mockGenerate,
    embed: vi.fn(),
    modelList: vi.fn(),
    healthCheck: vi.fn(),
  };
  return {
    projectId: 'proj-test',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Test Novel',
            logline: 'A hero',
            manuscript: [
              { id: 's1', title: 'Ch 1', content: 'Alice walked.', status: 'draft', act: 1 },
            ],
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [{ title: 'Act 1', description: 'Setup' }],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: partial test state
    } as any),
    manuscript: [],
    characters: [],
    worlds: [],
    config: DEFAULT_CONFIG,
    gateway: mockGateway,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseAgent', () => {
  let agent: StubAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({ text: 'COHERENT: Analysis is grounded.', usage: {} });
    mockGetMemoryBank.mockReturnValue({ recall: vi.fn(), remember: vi.fn() });
    agent = new StubAgent(makeContext());
  });

  describe('constructor', () => {
    it('uses gateway from context when provided', () => {
      const customGateway = {
        generate: vi.fn(),
        embed: vi.fn(),
        modelList: vi.fn(),
        healthCheck: vi.fn(),
      };
      const ctx = makeContext({ gateway: customGateway });
      const a = new StubAgent(ctx);
      expect(a['gateway']).toBe(customGateway);
    });

    it('falls back to module singleton when context.gateway is undefined', () => {
      const ctx = makeContext();
      // biome-ignore lint/suspicious/noExplicitAny: test access
      (ctx as any).gateway = undefined;
      const a = new StubAgent(ctx);
      // Falls back to the mocked inferenceGateway singleton
      expect(a['gateway']).toBeDefined();
    });
  });

  describe('requireProject()', () => {
    it('returns project data when present', () => {
      const project = agent.publicRequireProject();
      expect(project.title).toBe('Test Novel');
    });

    it('throws when project data is missing', () => {
      const ctx = makeContext();
      ctx.getState = vi.fn().mockReturnValue({ project: { present: null } });
      const a = new StubAgent(ctx);
      expect(() => a.publicRequireProject()).toThrow('No project data');
    });
  });

  describe('getMemoryBank()', () => {
    it('calls getMemoryBank with projectId', () => {
      agent.publicGetMemoryBank();
      expect(mockGetMemoryBank).toHaveBeenCalledWith('proj-test');
    });
  });

  describe('elapsed()', () => {
    it('returns a non-negative number', () => {
      const start = performance.now();
      const result = agent.publicElapsed(start);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('returns elapsed rounded to integer ms', () => {
      const start = performance.now() - 500;
      const result = agent.publicElapsed(start);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(499);
    });
  });

  describe('buildAiOpts()', () => {
    it('returns gemini-2.5-flash for gemini provider', () => {
      const opts = agent.publicBuildAiOpts();
      expect(opts.model).toBe('gemini-2.5-flash');
      expect(opts.provider).toBe('gemini');
      expect(opts.maxTokens).toBe(4000);
    });

    it('returns gpt-4o-mini for openai provider', () => {
      const ctx = makeContext({ config: { ...DEFAULT_CONFIG, aiProvider: 'openai' } });
      const a = new StubAgent(ctx);
      expect(a.publicBuildAiOpts().model).toBe('gpt-4o-mini');
    });

    it('returns claude-haiku-4-5 for anthropic provider', () => {
      const ctx = makeContext({ config: { ...DEFAULT_CONFIG, aiProvider: 'anthropic' } });
      const a = new StubAgent(ctx);
      expect(a.publicBuildAiOpts().model).toBe('claude-haiku-4-5');
    });

    it('returns grok-3-mini for grok provider', () => {
      const ctx = makeContext({ config: { ...DEFAULT_CONFIG, aiProvider: 'grok' } });
      const a = new StubAgent(ctx);
      expect(a.publicBuildAiOpts().model).toBe('grok-3-mini');
    });

    it('falls back to gemini-2.5-flash for unknown provider', () => {
      // biome-ignore lint/suspicious/noExplicitAny: test unknown provider
      const ctx = makeContext({ config: { ...DEFAULT_CONFIG, aiProvider: 'unknown' as any } });
      const a = new StubAgent(ctx);
      expect(a.publicBuildAiOpts().model).toBe('gemini-2.5-flash');
    });

    it('uses config.maxTokens when no override', () => {
      const ctx = makeContext({ config: { ...DEFAULT_CONFIG, maxTokens: 2048 } });
      const a = new StubAgent(ctx);
      expect(a.publicBuildAiOpts().maxTokens).toBe(2048);
    });

    it('override maxTokens takes precedence over config', () => {
      expect(agent.publicBuildAiOpts({ maxTokens: 512 }).maxTokens).toBe(512);
    });

    it('does NOT include signal in opts when not provided', () => {
      const opts = agent.publicBuildAiOpts();
      expect('signal' in opts).toBe(false);
    });

    it('includes signal in opts when provided', () => {
      const signal = new AbortController().signal;
      const opts = agent.publicBuildAiOpts({ signal });
      expect(opts.signal).toBe(signal);
    });
  });

  describe('generate()', () => {
    it('calls gateway.generate with correct params and returns text', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'Generated prose.', usage: {} });
      const result = await agent.publicGenerate('Write a story.', 800);
      expect(result).toBe('Generated prose.');
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Write a story.' }),
      );
    });

    it('passes undefined maxTokens path when not specified', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'OK', usage: {} });
      await agent.publicGenerate('Prompt without token limit');
      // config.maxTokens (4000) is used as fallback inside buildAiOpts
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ maxTokens: 4000 }) }),
      );
    });

    it('does not alter the prompt when no retry feedback is set', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'OK', usage: {} });
      await agent.publicGenerate('Original prompt.');
      expect(mockGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Original prompt.' }),
      );
    });

    it('prepends supervisor feedback to the prompt after setRetryFeedback', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'Corrected.', usage: {} });
      agent.setRetryFeedback('- No structural edits found.');
      await agent.publicGenerate('Original prompt.');
      const callArg = mockGenerate.mock.calls.at(-1)?.[0] as { prompt: string };
      expect(callArg.prompt).toContain('previous attempt was rejected');
      expect(callArg.prompt).toContain('No structural edits found.');
      expect(callArg.prompt).toContain('Original prompt.');
    });
  });

  describe('selfReflect()', () => {
    it('returns coherent:true when AI replies COHERENT', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'COHERENT: Grounded in text.', usage: {} });
      const result = await agent.publicSelfReflect(
        'excerpt',
        'summary',
        new AbortController().signal,
      );
      expect(result.coherent).toBe(true);
      expect(result.note).toContain('COHERENT');
    });

    it('returns coherent:false when AI replies INCOHERENT', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'INCOHERENT: Hallucinated facts.', usage: {} });
      const result = await agent.publicSelfReflect(
        'excerpt',
        'summary',
        new AbortController().signal,
      );
      expect(result.coherent).toBe(false);
    });

    it('skips reflection and returns coherent:true when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await agent.publicSelfReflect('excerpt', 'summary', controller.signal);
      expect(result.coherent).toBe(true);
      expect(result.note).toContain('aborted');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns coherent:true on AI error (graceful degradation)', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Network error'));
      const result = await agent.publicSelfReflect(
        'excerpt',
        'summary',
        new AbortController().signal,
      );
      expect(result.coherent).toBe(true);
      expect(result.note).toContain('AI error');
      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });

    it('truncates long excerpts to 800 chars in the prompt', async () => {
      mockGenerate.mockResolvedValueOnce({ text: 'COHERENT: ok', usage: {} });
      const longExcerpt = 'x'.repeat(2000);
      await agent.publicSelfReflect(longExcerpt, 'short summary', new AbortController().signal);
      const callArg = mockGenerate.mock.calls[0]?.[0] as { prompt: string };
      // The prompt slice is applied — excerpt in prompt should be ≤ 800 chars
      const excerptInPrompt =
        callArg.prompt.split('MANUSCRIPT EXCERPT:\n')[1]?.split('\n\nANALYSIS')[0] ?? '';
      expect(excerptInPrompt.length).toBeLessThanOrEqual(800);
    });
  });
});
