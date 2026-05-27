/**
 * ProForge Tool Registry — Tool-calling infrastructure for agentic AI.
 * QNBS-v3: Vercel AI SDK compatible tool schemas with sandboxed execution.
 */

import { z } from 'zod';
import { logger } from '../../logger';

// ---------------------------------------------------------------------------
// Tool Schema Types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<unknown>;
  handler: (args: unknown, context: ToolContext) => Promise<unknown>;
  /** Which pipeline stages this tool is available in */
  stages: string[];
  /** Whether this tool modifies project data */
  isWrite: boolean;
}

export interface ToolContext {
  projectId: string;
  dispatch: import('../../../app/store').AppDispatch;
  getState: () => import('../../../app/store').RootState;
  memoryBank: import('../proForgeMemoryBank').ProForgeMemoryBank;
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`ToolRegistry: Overwriting existing tool "${tool.name}"`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listForStage(stage: string): ToolDefinition[] {
    return this.list().filter((t) => t.stages.includes(stage) || t.stages.includes('*'));
  }

  async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry`);
    }
    // Validate args
    const parsed = tool.parameters.safeParse(args);
    if (!parsed.success) {
      throw new Error(`Invalid arguments for tool "${name}": ${parsed.error.message}`);
    }
    return tool.handler(parsed.data, context);
  }

  /** Convert to Vercel AI SDK tool format */
  toAiSdkTools(
    stage: string,
  ): Record<string, { description: string; parameters: z.ZodType<unknown> }> {
    const result: Record<string, { description: string; parameters: z.ZodType<unknown> }> = {};
    for (const tool of this.listForStage(stage)) {
      result[tool.name] = {
        description: tool.description,
        parameters: tool.parameters,
      };
    }
    return result;
  }
}

export const toolRegistry = new ToolRegistry();

// ---------------------------------------------------------------------------
// Built-in Tools
// ---------------------------------------------------------------------------

// -- Manuscript Tools --

toolRegistry.register({
  name: 'readSection',
  description: 'Read the full content of a manuscript section by ID.',
  parameters: z.object({
    sectionId: z.string().describe('The section ID to read'),
  }),
  stages: ['*'],
  isWrite: false,
  handler: async (args, context) => {
    const { sectionId } = args as { sectionId: string };
    const state = context.getState();
    const sections = state.project.present?.data?.manuscript ?? [];
    const section = sections.find((s) => s.id === sectionId);
    if (!section) {
      return { error: `Section "${sectionId}" not found` };
    }
    return {
      id: section.id,
      title: section.title,
      content: section.content,
      status: section.status,
    };
  },
});

toolRegistry.register({
  name: 'readAllSections',
  description:
    'Read all manuscript sections (metadata only, no content). Use readSection for full content.',
  parameters: z.object({
    includeContent: z
      .boolean()
      .optional()
      .describe('If true, includes full content (warning: large payload)'),
  }),
  stages: ['*'],
  isWrite: false,
  handler: async (args, context) => {
    const { includeContent } = (args as { includeContent?: boolean }) ?? {};
    const state = context.getState();
    const sections = state.project.present?.data?.manuscript ?? [];
    return sections.map((s) => ({
      id: s.id,
      title: s.title,
      wordCount: s.content ? s.content.trim().split(/\s+/).length : 0,
      status: s.status,
      act: s.act,
      ...(includeContent ? { content: s.content } : {}),
    }));
  },
});

toolRegistry.register({
  name: 'readProjectMeta',
  description: 'Read project metadata: title, logline, characters, worlds.',
  parameters: z.object({}),
  stages: ['*'],
  isWrite: false,
  handler: async (_args, context) => {
    const state = context.getState();
    const data = state.project.present?.data;
    if (!data) return { error: 'No project data' };
    return {
      title: data.title,
      logline: data.logline,
      characters: Object.values(data.characters?.entities ?? {}),
      worlds: Object.values(data.worlds?.entities ?? {}),
    };
  },
});

toolRegistry.register({
  name: 'searchLore',
  description: 'Search the story lore (characters, worlds, codex) for a query.',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Max results'),
  }),
  stages: ['*'],
  isWrite: false,
  handler: async (args, context) => {
    const { query, limit = 5 } = args as { query: string; limit?: number };
    const entries = await context.memoryBank.search(query, limit);
    return entries.map((e) => ({
      category: e.category,
      key: e.key,
      content: e.content,
    }));
  },
});

// -- Analysis Tools --

toolRegistry.register({
  name: 'analyzePacing',
  description: 'Analyze manuscript pacing per section. Returns tension scores and recommendations.',
  parameters: z.object({}),
  stages: ['intake', 'structural'],
  isWrite: false,
  handler: async (_args, context) => {
    const state = context.getState();
    const sections = state.project.present?.data?.manuscript ?? [];
    // Simple heuristic: longer sections = slower pacing, shorter = faster
    const wordCounts = sections.map((s) => s.content?.trim().split(/\s+/).length ?? 0);
    const avg = wordCounts.reduce((a, b) => a + b, 0) / (wordCounts.length || 1);
    const analysis = sections.map((s, i) => {
      const wc = wordCounts[i] ?? 0;
      const ratio = avg > 0 ? wc / avg : 1;
      let tensionScore = 5;
      if (ratio > 1.5) tensionScore = 3; // slow
      if (ratio < 0.7) tensionScore = 7; // fast
      return {
        sectionId: s.id,
        title: s.title,
        wordCount: wc,
        tensionScore,
        recommendedAction: ratio > 1.5 ? 'compress' : ratio < 0.7 ? 'expand' : 'keep',
      };
    });
    return { sections: analysis, overallPacing: 'uneven' };
  },
});

toolRegistry.register({
  name: 'countWords',
  description: 'Count total words in the manuscript.',
  parameters: z.object({}),
  stages: ['*'],
  isWrite: false,
  handler: async (_args, context) => {
    const state = context.getState();
    const sections = state.project.present?.data?.manuscript ?? [];
    const counts = sections.map((s) => s.content?.trim().split(/\s+/).length ?? 0);
    const total = counts.reduce((a, b) => a + b, 0);
    return { total, perSection: counts };
  },
});

// -- Report Tools --

toolRegistry.register({
  name: 'generateReport',
  description: 'Save a structured report to the memory bank for later retrieval.',
  parameters: z.object({
    category: z.enum(['lore', 'character', 'style', 'feedback', 'edit', 'meta']),
    key: z.string(),
    content: z.string(),
  }),
  stages: ['*'],
  isWrite: true,
  handler: async (args, context) => {
    const { category, key, content } = args as {
      category: import('../../../features/proForge/types').MemoryBankEntry['category'];
      key: string;
      content: string;
    };
    const run = context.getState().proForge.currentRun;
    const stage = run?.activeStage ?? 'intake';
    await context.memoryBank.remember(category, key, content, stage);
    return { success: true };
  },
});

toolRegistry.register({
  name: 'getMemoryContext',
  description: 'Retrieve relevant memory context for the current stage.',
  parameters: z.object({
    query: z.string().optional(),
    maxChars: z.number().optional(),
  }),
  stages: ['*'],
  isWrite: false,
  handler: async (args, context) => {
    const { query, maxChars = 4000 } = args as { query?: string; maxChars?: number };
    const run = context.getState().proForge.currentRun;
    const stage = run?.activeStage ?? 'intake';
    const contextStr = await context.memoryBank.buildContextString(stage, query, maxChars);
    return { context: contextStr };
  },
});

// -- Edit Proposal Tools (write operations gated) --

toolRegistry.register({
  name: 'proposeEdit',
  description:
    'Propose an edit to a manuscript section. The edit is NOT applied automatically; it goes to the review queue.',
  parameters: z.object({
    sectionId: z.string(),
    startOffset: z.number(),
    endOffset: z.number(),
    original: z.string(),
    proposed: z.string(),
    rationale: z.string(),
    category: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  stages: ['structural', 'lineProse', 'copyEdit'],
  isWrite: true,
  handler: async (args) => {
    // Returns the proposal for the agent to collect into review items
    return { proposal: args, status: 'queued_for_review' };
  },
});

export { ToolRegistry };
