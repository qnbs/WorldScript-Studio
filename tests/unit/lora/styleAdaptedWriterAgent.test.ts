/**
 * Tests for services/proForge/pipelineAgents/styleAdaptedWriterAgent.ts
 * QNBS-v3: Fallback path (no active adapter) + suggestion path with mocked localAiFacade.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../services/loraAdapterService', () => ({
  getActiveAdapter: vi.fn(),
}));

vi.mock('../../../services/localAiFacade', () => ({
  generateLocalText: vi.fn(),
}));

vi.mock('../../../services/proForge/proForgeMemoryBank', () => ({
  getMemoryBank: vi.fn(() => ({
    buildContextString: vi.fn().mockResolvedValue(''),
    remember: vi.fn(),
    recall: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../services/aiProviderService', () => ({
  aiProviderService: { generateText: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { generateLocalText } from '../../../services/localAiFacade';
import { getActiveAdapter } from '../../../services/loraAdapterService';
import { StyleAdaptedWriterAgent } from '../../../services/proForge/pipelineAgents/styleAdaptedWriterAgent';
import type { OrchestratorContext } from '../../../services/proForge/proForgeOrchestrator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTIVE_ADAPTER = {
  id: 'lora-1',
  name: 'HemingwayStyle',
  description: '',
  modelCompatibility: 'llama-3.2-7b',
  scale: 1,
  fileSizeBytes: 100,
  createdAt: 1,
  isActive: true,
};

/** Long enough content to pass the 200-char threshold in the agent (≥ 201 chars). */
const LONG_CONTENT =
  'The old lighthouse keeper had not left the island in forty years. ' +
  'Each morning he climbed the spiral staircase and polished the great lens until it blazed. ' +
  'Tonight a storm was drawing close across the black water and the fog horns wailed.';

function makeContext(
  sections = [{ id: 's1', title: 'Ch 1', content: LONG_CONTENT }],
): OrchestratorContext {
  return {
    projectId: 'proj-1',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            title: 'Test Novel',
            logline: '',
            manuscript: sections,
            characters: { ids: [], entities: {} },
            worlds: { ids: [], entities: {} },
            outline: [],
          },
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: partial test state
    } as any),
    manuscript: sections,
    characters: [],
    worlds: [],
    config: {
      genrePreset: 'literary-fiction',
      selectedStages: ['lineProse'],
      aiProvider: 'webllm',
      ragMode: 'hybrid',
      maxTokens: 2000,
      creativity: 'Balanced',
      useDuckDb: false,
      autoAcceptThreshold: 0,
      language: 'en',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StyleAdaptedWriterAgent — no active adapter', () => {
  beforeEach(() => {
    vi.mocked(getActiveAdapter).mockResolvedValue(null);
  });

  it('returns isFallback: true and empty reviewItems', async () => {
    const agent = new StyleAdaptedWriterAgent(makeContext());
    const result = await agent.execute(new AbortController().signal);

    expect(result.reviewItems).toHaveLength(0);
    expect(result.agentOutput).toMatchObject({ isFallback: true, reason: 'no_active_adapter' });
    expect(result.metrics.aiCalls).toBe(0);
  });
});

describe('StyleAdaptedWriterAgent — with active adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActiveAdapter).mockResolvedValue(ACTIVE_ADAPTER);
    vi.mocked(generateLocalText).mockResolvedValue({
      layer: 'webllm' as const,
      text: 'The keeper gripped the railing as the storm surged closer, each wave a drumbeat of inevitability.',
    });
  });

  it('produces at least one proseEdit reviewItem', async () => {
    const agent = new StyleAdaptedWriterAgent(makeContext());
    const result = await agent.execute(new AbortController().signal);

    // Verify the mock was actually invoked via the dynamic import path
    expect(vi.mocked(generateLocalText)).toHaveBeenCalled();
    expect(result.reviewItems.length).toBeGreaterThan(0);
    expect(result.reviewItems[0]!.type).toBe('proseEdit');
    expect(result.reviewItems[0]!.sectionId).toBe('s1');
    expect(result.agentOutput).not.toHaveProperty('isFallback');
  });

  it('reports adapter id and name in agentOutput', async () => {
    const agent = new StyleAdaptedWriterAgent(makeContext());
    const result = await agent.execute(new AbortController().signal);

    expect(result.agentOutput).toMatchObject({
      adapterId: 'lora-1',
      adapterName: 'HemingwayStyle',
    });
  });

  it('skips sections shorter than 200 characters', async () => {
    const agent = new StyleAdaptedWriterAgent(
      makeContext([{ id: 's1', title: 'Short', content: 'Too short.' }]),
    );
    const result = await agent.execute(new AbortController().signal);
    expect(result.reviewItems).toHaveLength(0);
    expect(vi.mocked(generateLocalText)).not.toHaveBeenCalled();
  });

  it('returns isFallback: true when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const agent = new StyleAdaptedWriterAgent(makeContext());
    const result = await agent.execute(ctrl.signal);

    expect(result.agentOutput).toMatchObject({ isFallback: true, reason: 'aborted' });
  });
});
