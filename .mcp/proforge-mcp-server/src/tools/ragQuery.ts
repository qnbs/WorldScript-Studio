/**
 * MCP tool: proforge_rag_query — retrieve relevant entries from the project memory bank.
 * QNBS-v3: Lexical by default (no AI key needed); semantic/hybrid degrade to lexical in Node when
 * no embedding model is available. Delegates to the Core Capability Layer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveCapability } from '../capability';
import { fail, ok, projectShape } from './shared';

export function registerRagQuery(server: McpServer): void {
  server.registerTool(
    'proforge_rag_query',
    {
      title: 'Query the ProForge memory bank',
      description:
        'Retrieve the most relevant memory-bank entries (lore, character, style, prior edits) for a ' +
        'query. Seed entries via the project payload `memoryEntries`. Modes: lexical (default), ' +
        'semantic, hybrid — semantic/hybrid fall back to lexical when no embedding model is present.',
      inputSchema: {
        project: projectShape.optional(),
        query: z.string().min(1),
        k: z.number().int().positive().max(50).optional(),
        mode: z.enum(['lexical', 'semantic', 'hybrid']).optional(),
      },
    },
    async ({ project, query, k, mode }) => {
      try {
        const { cap, payload } = await resolveCapability(project);
        const result = await cap.ragQuery({
          projectId: payload.projectId,
          query,
          ...(k !== undefined && { k }),
          ...(mode !== undefined && { mode }),
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
