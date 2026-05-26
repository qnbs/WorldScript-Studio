/**
 * Tests for ProForge ToolRegistry.
 * QNBS-v3: Pure class behaviour — mocks logger and memoryBank.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks are set up
import {
  type ToolContext,
  type ToolDefinition,
  ToolRegistry,
  toolRegistry,
} from '../../../services/proForge/pipelineTools/toolRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'testTool',
    description: 'A test tool',
    parameters: z.object({ input: z.string() }),
    handler: vi.fn().mockResolvedValue({ result: 'ok' }),
    stages: ['intake'],
    isWrite: false,
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    projectId: 'proj-1',
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    dispatch: vi.fn() as any,
    getState: vi.fn().mockReturnValue({
      project: {
        present: {
          data: { manuscript: [], characters: { entities: {} }, worlds: { entities: {} } },
        },
      },
      proForge: { currentRun: null },
    }),
    memoryBank: {
      search: vi.fn().mockResolvedValue([]),
      buildContextString: vi.fn().mockResolvedValue(''),
      remember: vi.fn().mockResolvedValue({}),
      recall: vi.fn().mockResolvedValue([]),
      recallForStage: vi.fn().mockResolvedValue([]),
      clear: vi.fn().mockResolvedValue(undefined),
      // biome-ignore lint/suspicious/noExplicitAny: test mock
    } as any,
    signal: new AbortController().signal,
  };
}

// ---------------------------------------------------------------------------
// ToolRegistry class tests
// ---------------------------------------------------------------------------

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register / get', () => {
    it('registers a tool and retrieves it by name', () => {
      const tool = makeTool({ name: 'myTool' });
      registry.register(tool);
      expect(registry.get('myTool')).toBe(tool);
    });

    it('returns undefined for unknown tool', () => {
      expect(registry.get('nonExistent')).toBeUndefined();
    });

    it('overwrites an existing tool on re-register (warns)', async () => {
      const { logger } = await import('../../../services/logger');
      const tool1 = makeTool({ name: 'dup' });
      const tool2 = makeTool({ name: 'dup', description: 'updated' });
      registry.register(tool1);
      registry.register(tool2);
      expect(registry.get('dup')?.description).toBe('updated');
      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('removes a registered tool and returns true', () => {
      registry.register(makeTool({ name: 'toRemove' }));
      expect(registry.unregister('toRemove')).toBe(true);
      expect(registry.get('toRemove')).toBeUndefined();
    });

    it('returns false when tool does not exist', () => {
      expect(registry.unregister('ghost')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.list()).toHaveLength(0);
    });

    it('returns all registered tools', () => {
      registry.register(makeTool({ name: 'a' }));
      registry.register(makeTool({ name: 'b' }));
      expect(registry.list()).toHaveLength(2);
    });
  });

  describe('listForStage', () => {
    beforeEach(() => {
      registry.register(makeTool({ name: 'intakeTool', stages: ['intake'] }));
      registry.register(makeTool({ name: 'structuralTool', stages: ['structural'] }));
      registry.register(makeTool({ name: 'globalTool', stages: ['*'] }));
    });

    it('returns tools for the specified stage plus global tools', () => {
      const tools = registry.listForStage('intake');
      const names = tools.map((t) => t.name);
      expect(names).toContain('intakeTool');
      expect(names).toContain('globalTool');
      expect(names).not.toContain('structuralTool');
    });

    it('returns only global tools for an unmatched stage', () => {
      const tools = registry.listForStage('proof');
      expect(tools.map((t) => t.name)).toEqual(['globalTool']);
    });

    it('returns nothing if no tools match', () => {
      const emptyRegistry = new ToolRegistry();
      emptyRegistry.register(makeTool({ name: 'intakeOnly', stages: ['intake'] }));
      expect(emptyRegistry.listForStage('analytics')).toHaveLength(0);
    });
  });

  describe('execute', () => {
    it('calls the handler with validated args and returns the result', async () => {
      const handler = vi.fn().mockResolvedValue({ done: true });
      registry.register(makeTool({ name: 'execTool', handler }));
      const ctx = makeContext();
      const result = await registry.execute('execTool', { input: 'hello' }, ctx);
      expect(result).toEqual({ done: true });
      expect(handler).toHaveBeenCalledWith({ input: 'hello' }, ctx);
    });

    it('throws when tool is not registered', async () => {
      await expect(registry.execute('missing', {}, makeContext())).rejects.toThrow(
        'Tool "missing" not found',
      );
    });

    it('throws on invalid arguments (schema mismatch)', async () => {
      registry.register(makeTool({ name: 'strictTool' }));
      await expect(registry.execute('strictTool', { input: 123 }, makeContext())).rejects.toThrow(
        'Invalid arguments for tool',
      );
    });
  });

  describe('toAiSdkTools', () => {
    it('returns tool descriptions and parameters for the stage', () => {
      registry.register(
        makeTool({ name: 'aiTool', stages: ['intake'], description: 'AI tool desc' }),
      );
      const sdkTools = registry.toAiSdkTools('intake');
      expect(sdkTools['aiTool']).toBeDefined();
      expect(sdkTools['aiTool']!.description).toBe('AI tool desc');
      expect(sdkTools['aiTool']!.parameters).toBeDefined();
    });

    it('excludes tools not available in the stage', () => {
      registry.register(makeTool({ name: 'proofOnly', stages: ['proof'] }));
      const sdkTools = registry.toAiSdkTools('intake');
      expect(sdkTools['proofOnly']).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Global toolRegistry singleton — built-in tools
// ---------------------------------------------------------------------------

describe('toolRegistry singleton (built-in tools)', () => {
  it('has readSection registered', () => {
    expect(toolRegistry.get('readSection')).toBeDefined();
  });

  it('has readAllSections registered', () => {
    expect(toolRegistry.get('readAllSections')).toBeDefined();
  });

  it('has readProjectMeta registered', () => {
    expect(toolRegistry.get('readProjectMeta')).toBeDefined();
  });

  it('has searchLore registered', () => {
    expect(toolRegistry.get('searchLore')).toBeDefined();
  });

  it('has analyzePacing registered (intake/structural only)', () => {
    const tool = toolRegistry.get('analyzePacing');
    expect(tool).toBeDefined();
    expect(tool?.stages).toContain('intake');
    expect(tool?.stages).toContain('structural');
  });

  it('has countWords registered', () => {
    expect(toolRegistry.get('countWords')).toBeDefined();
  });

  it('has generateReport registered', () => {
    expect(toolRegistry.get('generateReport')).toBeDefined();
  });

  it('has getMemoryContext registered', () => {
    expect(toolRegistry.get('getMemoryContext')).toBeDefined();
  });

  it('has proposeEdit registered (write tool)', () => {
    const tool = toolRegistry.get('proposeEdit');
    expect(tool).toBeDefined();
    expect(tool?.isWrite).toBe(true);
  });

  it('readSection handler returns section data', async () => {
    const ctx = makeContext();
    ctx.getState = vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            manuscript: [
              { id: 's1', title: 'Ch 1', content: 'Hello world', status: 'draft', act: 1 },
            ],
            characters: { entities: {} },
            worlds: { entities: {} },
          },
        },
      },
      proForge: { currentRun: null },
    });
    const result = (await toolRegistry.execute('readSection', { sectionId: 's1' }, ctx)) as Record<
      string,
      unknown
    >;
    expect(result['id']).toBe('s1');
    expect(result['title']).toBe('Ch 1');
    expect(result['content']).toBe('Hello world');
  });

  it('readSection handler returns error for unknown section', async () => {
    const ctx = makeContext();
    const result = (await toolRegistry.execute(
      'readSection',
      { sectionId: 'ghost' },
      ctx,
    )) as Record<string, unknown>;
    expect(result['error']).toContain('"ghost" not found');
  });

  it('countWords handler returns total word count', async () => {
    const ctx = makeContext();
    ctx.getState = vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            manuscript: [
              { id: 's1', title: 'Ch 1', content: 'one two three' },
              { id: 's2', title: 'Ch 2', content: 'four five' },
            ],
          },
        },
      },
      proForge: { currentRun: null },
    });
    const result = (await toolRegistry.execute('countWords', {}, ctx)) as Record<string, unknown>;
    expect(result['total']).toBe(5);
  });

  it('readAllSections returns metadata without content by default', async () => {
    const ctx = makeContext();
    ctx.getState = vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            manuscript: [
              { id: 's1', title: 'Ch 1', content: 'alpha beta', status: 'draft', act: 1 },
            ],
          },
        },
      },
      proForge: { currentRun: null },
    });
    const result = (await toolRegistry.execute('readAllSections', {}, ctx)) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]!['content']).toBeUndefined();
    expect(result[0]!['wordCount']).toBe(2);
  });

  it('analyzePacing categorizes sections by word count relative to average', async () => {
    const ctx = makeContext();
    // Section 1 has 3x the words of section 2 → should be flagged as slow
    ctx.getState = vi.fn().mockReturnValue({
      project: {
        present: {
          data: {
            manuscript: [
              { id: 's1', title: 'Long', content: 'word '.repeat(300) },
              { id: 's2', title: 'Short', content: 'a b c d e' },
            ],
          },
        },
      },
      proForge: { currentRun: null },
    });
    const result = (await toolRegistry.execute('analyzePacing', {}, ctx)) as {
      sections: Array<{ recommendedAction: string }>;
    };
    expect(result.sections[0]!.recommendedAction).toBe('compress');
  });
});
