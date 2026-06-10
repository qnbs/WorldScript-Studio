/**
 * MCP tool: proforge_apply_edits — offset-safe application of accepted edits to manuscript text.
 * QNBS-v3: Pure op — no AI, no project context needed. Delegates to the Core Capability Layer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { inlineCapability } from '../capability';
import { fail, ok } from './shared';

export function registerApplyEdits(server: McpServer): void {
  server.registerTool(
    'proforge_apply_edits',
    {
      title: 'Apply accepted edits to a manuscript',
      description:
        'Apply a set of accepted edits to manuscript sections, offset-safe (back-to-front) with a ' +
        'text-match fallback for stale offsets. Returns updated section contents plus applied/' +
        'skipped counts. Use dryRun to preview without mutating. No AI key required.',
      inputSchema: {
        manuscript: z.array(z.object({ id: z.string(), content: z.string().default('') })),
        items: z.array(
          z.object({
            id: z.string(),
            sectionId: z.string().optional(),
            range: z.object({ start: z.number(), end: z.number() }).optional(),
            original: z.string().optional(),
            proposed: z.string().optional(),
          }),
        ),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ manuscript, items, dryRun }) => {
      try {
        const cap = await inlineCapability();
        const result = await cap.applyEdits({
          manuscript,
          items,
          ...(dryRun !== undefined && { dryRun }),
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
