/**
 * Tests for PublishingAgent — ProForge Pipeline Stage 7 (publishing).
 * QNBS-v3: Mocks InferenceGateway (via context.gateway) + memoryBank; exercises happy path, fallback, schema validation, memoryBank calls.
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
  getPrompt: vi.fn(() => 'mocked publishing prompt'),
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
import { PublishingAgent } from '../../../../services/proForge/pipelineAgents/publishingAgent';
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
  selectedStages: ['publishing'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

const VALID_PACKAGE = {
  metadata: {
    title: 'My Novel',
    author: 'Jane Doe',
    description: 'A gripping tale.',
    keywords: ['fiction', 'drama'],
    genre: 'literary-fiction',
    bisacCodes: ['FIC000000'],
    language: 'en',
    wordCount: 80000,
  },
  blurbs: {
    backCover: 'A story that will keep you on the edge.',
    amazonDescription: 'In this debut novel, Jane Doe weaves a tale of mystery.',
    tagline: 'Truth lies in the shadows.',
    elevatorPitch: 'A detective races to solve a murder before the killer strikes again.',
    socialMediaPosts: ['Read My Novel — now available!'],
  },
  audiobookGuide: {
    chapterMarks: [{ sectionId: 's1', title: 'Chapter 1', estimatedDurationMinutes: 15 }],
    overallNotes: 'Narrator should use a calm, measured pace.',
  },
  marketingAssets: {
    socialMediaPosts: [{ platform: 'Twitter', text: 'Check out My Novel!' }],
    newsletterText: 'Announcing the release of My Novel.',
    adCopyVariants: ['Award-winning fiction for discerning readers.'],
    authorBioSuggestion: 'Jane Doe is a literary fiction author based in Berlin.',
  },
  rightsPage: '© 2026 Jane Doe. All rights reserved.',
};

function makeContext(): OrchestratorContext {
  return {
    projectId: 'proj-publish',
    dispatch: vi.fn() as unknown as OrchestratorContext['dispatch'],
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'My Novel',
            logline: 'A detective story.',
            manuscript: [
              { id: 's1', title: 'Chapter 1', content: 'Alice walked into the room slowly.' },
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

describe('PublishingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify(VALID_PACKAGE)));
  });

  describe('happy path', () => {
    it('returns reviewItems, metrics, and agentOutput on valid AI response', async () => {
      const agent = new PublishingAgent(makeContext());
      const result = await agent.execute(new AbortController().signal);

      expect(result.reviewItems).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.agentOutput).toBeDefined();
    });

    it('always produces exactly 3 reviewItems (metadata, blurb, audiobook)', async () => {
      const agent = new PublishingAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      expect(reviewItems).toHaveLength(3);
      expect(reviewItems.map((r) => r.id)).toEqual(
        expect.arrayContaining(['pub-metadata', 'pub-blurb', 'pub-audiobook']),
      );
    });

    it('pub-audiobook reviewItem shows correct chapter mark count', async () => {
      const agent = new PublishingAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      const audiobookItem = reviewItems.find((r) => r.id === 'pub-audiobook');
      expect(audiobookItem?.description).toContain('1 chapter marks');
    });

    it('records aiCalls=1', async () => {
      const agent = new PublishingAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(1);
    });

    it('calls memoryBank.buildContextString with "publishing"', async () => {
      const agent = new PublishingAgent(makeContext());
      await agent.execute(new AbortController().signal);

      // QNBS-v3: story-anchored query + the run's ragMode are threaded so semantic/hybrid recall is honoured.
      expect(mockMemoryBank.buildContextString).toHaveBeenCalledWith(
        'publishing',
        expect.stringContaining('My Novel'),
        2000,
        'hybrid',
      );
    });

    it('saves publishingPackage to memoryBank under "meta" category', async () => {
      const agent = new PublishingAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(mockMemoryBank.remember).toHaveBeenCalledWith(
        'meta',
        'publishingPackage',
        expect.stringContaining('"metadata"'),
        'publishing',
      );
    });

    it('handles AI response wrapped in ```json code fences', async () => {
      mockGenerate.mockResolvedValue(
        gatewayResult(`\`\`\`json\n${JSON.stringify(VALID_PACKAGE)}\n\`\`\``),
      );

      const agent = new PublishingAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const pkg = agentOutput as { metadata: { title: string } };
      expect(pkg.metadata.title).toBe('My Novel');
    });
  });

  describe('fallback behaviour', () => {
    it('uses fallback package when AI returns invalid JSON', async () => {
      mockGenerate.mockResolvedValue(gatewayResult('not valid json {{{'));

      const agent = new PublishingAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const pkg = agentOutput as { metadata: { title: string } };
      // Fallback uses project title
      expect(pkg.metadata.title).toBe('My Novel');
    });

    it('uses fallback package when schema validation fails', async () => {
      mockGenerate.mockResolvedValue(gatewayResult(JSON.stringify({ invalid: 'structure' })));

      const agent = new PublishingAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
      const pkg = agentOutput as { blurbs: { tagline: string } };
      // Fallback tagline is the project title
      expect(pkg.blurbs.tagline).toBe('My Novel');
    });

    it('uses fallback package when AI call throws', async () => {
      mockGenerate.mockRejectedValue(new Error('API error'));

      const agent = new PublishingAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.error)).toHaveBeenCalled();
      const pkg = agentOutput as { metadata: { author: string } };
      expect(pkg.metadata.author).toBe('Author'); // fallback default
    });

    it('fallback audiobookGuide has empty chapterMarks array', async () => {
      mockGenerate.mockRejectedValue(new Error('fail'));

      const agent = new PublishingAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const pkg = agentOutput as { audiobookGuide: { chapterMarks: unknown[] } };
      expect(pkg.audiobookGuide.chapterMarks).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws when project data is unavailable', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: { present: null },
        proForge: { currentRun: null },
      } as unknown as ReturnType<OrchestratorContext['getState']>);

      const agent = new PublishingAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });
  });
});
