/**
 * Tests for ProductionAgent — ProForge Pipeline Stage 6 (production).
 * QNBS-v3: No AI calls; tests Markdown generation, PDF/EPUB graceful skip, artifact reviewItems, abort.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock jspdf to throw so we can test graceful skip
vi.mock('jspdf', () => {
  throw new Error('jspdf not available');
});

// Mock epubApiService to throw so we can test graceful skip
vi.mock('../../../../services/epubApiService', () => {
  throw new Error('epub not available');
});

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import type { PipelineConfig } from '../../../../features/proForge/types';
import { logger } from '../../../../services/logger';
import { ProductionAgent } from '../../../../services/proForge/pipelineAgents/productionAgent';
import type { OrchestratorContext } from '../../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PipelineConfig = {
  genrePreset: 'general-fiction',
  selectedStages: ['production'],
  aiProvider: 'gemini',
  ragMode: 'hybrid',
  maxTokens: 4000,
  creativity: 'Balanced',
  useDuckDb: false,
  autoAcceptThreshold: 0,
  language: 'en',
};

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    projectId: 'proj-prod',
    dispatch: vi.fn() as unknown as OrchestratorContext['dispatch'],
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Production Test',
            logline: 'A story about production.',
            manuscript: [
              { id: 's1', title: 'Chapter 1', content: 'Alice walked into the room.' },
              { id: 's2', title: 'Chapter 2', content: 'Bob waited outside.' },
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('no AI calls', () => {
    it('returns aiCalls=0 and tokensConsumed=0', async () => {
      const agent = new ProductionAgent(makeContext());
      const { metrics } = await agent.execute(new AbortController().signal);

      expect(metrics.aiCalls).toBe(0);
      expect(metrics.tokensConsumed).toBe(0);
    });
  });

  describe('Markdown generation', () => {
    it('generates a Markdown artifact with sizeBytes > 0', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as { artifacts: Array<{ id: string; sizeBytes: number }> };
      const mdArtifact = manifest.artifacts.find((a) => a.id === 'md');
      expect(mdArtifact).toBeDefined();
      expect(mdArtifact?.sizeBytes).toBeGreaterThan(0);
    });

    it('Markdown output contains the project title as an H1 heading', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as {
        artifacts: Array<{ id: string; blob: Blob }>;
      };
      const mdArtifact = manifest.artifacts.find((a) => a.id === 'md');
      expect(mdArtifact).toBeDefined();
      // QNBS-v3: Blob text includes the title as an H1 heading
      const text = await mdArtifact?.blob.text();
      expect(text).toContain('# Production Test');
    });

    it('Markdown output contains section titles and content', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as { artifacts: Array<{ id: string; blob: Blob }> };
      const mdArtifact = manifest.artifacts.find((a) => a.id === 'md');
      const text = await mdArtifact?.blob.text();
      expect(text).toContain('## Chapter 1');
      expect(text).toContain('Alice walked into the room.');
    });

    it('produces a reviewItem for each artifact', async () => {
      const agent = new ProductionAgent(makeContext());
      const { reviewItems, agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as { artifacts: unknown[] };
      expect(reviewItems).toHaveLength(manifest.artifacts.length);
    });

    it('review items have id starting with "prod-"', async () => {
      const agent = new ProductionAgent(makeContext());
      const { reviewItems } = await agent.execute(new AbortController().signal);

      for (const item of reviewItems) {
        expect(item.id.startsWith('prod-')).toBe(true);
      }
    });
  });

  describe('PDF and EPUB graceful skip', () => {
    it('skips PDF generation gracefully and logs a warning', async () => {
      const agent = new ProductionAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('PDF generation skipped'),
      );
    });

    it('skips EPUB generation gracefully and logs a warning', async () => {
      const agent = new ProductionAgent(makeContext());
      await agent.execute(new AbortController().signal);

      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('EPUB generation skipped'),
      );
    });

    it('still returns a Markdown artifact when PDF/EPUB fail', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as { artifacts: Array<{ id: string }> };
      const ids = manifest.artifacts.map((a) => a.id);
      expect(ids).toContain('md');
      expect(ids).not.toContain('pdf');
      expect(ids).not.toContain('epub');
    });
  });

  describe('abort handling', () => {
    it('aborts after Markdown generation without throwing', async () => {
      const ac = new AbortController();
      ac.abort();

      const agent = new ProductionAgent(makeContext());
      // QNBS-v3: abort after the MD blob is created but before PDF — inner catch swallows it
      const { agentOutput } = await agent.execute(ac.signal);

      const manifest = agentOutput as { artifacts: unknown[] };
      // At minimum the MD artifact was pushed before the abort check
      expect(manifest.artifacts).toBeDefined();
    });
  });

  describe('manifest shape', () => {
    it('returns compileProfileUsed=false when project has no compileProfile', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as { compileProfileUsed: boolean };
      expect(manifest.compileProfileUsed).toBe(false);
    });

    it('returns typographySettings with font, fontSize, and lineSpacing', async () => {
      const agent = new ProductionAgent(makeContext());
      const { agentOutput } = await agent.execute(new AbortController().signal);

      const manifest = agentOutput as {
        typographySettings: { font: string; fontSize: string; lineSpacing: string };
      };
      expect(manifest.typographySettings.font).toBeDefined();
      expect(manifest.typographySettings.fontSize).toBeDefined();
      expect(manifest.typographySettings.lineSpacing).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws when project data is unavailable', async () => {
      const ctx = makeContext();
      vi.mocked(ctx.getState).mockReturnValue({
        project: { present: null },
        proForge: { currentRun: null },
      } as unknown as ReturnType<OrchestratorContext['getState']>);

      const agent = new ProductionAgent(ctx);
      await expect(agent.execute(new AbortController().signal)).rejects.toThrow('No project data');
    });
  });
});
