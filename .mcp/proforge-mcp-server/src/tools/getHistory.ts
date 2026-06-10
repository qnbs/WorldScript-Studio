/**
 * MCP tool: proforge_get_history — list completed/aborted pipeline runs for a project.
 * QNBS-v3: Reads the optional `--history <file>` JSON store. No AI key required.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveCapability } from '../capability';
import { fail, ok, projectShape } from './shared';

export function registerGetHistory(server: McpServer): void {
  server.registerTool(
    'proforge_get_history',
    {
      title: 'Get ProForge run history',
      description:
        'Return completed/aborted pipeline runs for a project (most recent first). Requires the ' +
        'server to be started with --history <file>; filter to a single run with runId.',
      inputSchema: {
        project: projectShape.optional(),
        limit: z.number().int().positive().max(100).optional(),
        runId: z.string().optional(),
      },
    },
    async ({ project, limit, runId }) => {
      try {
        const { cap, payload } = await resolveCapability(project);
        const result = await cap.getHistory({
          projectId: payload.projectId,
          ...(limit !== undefined && { limit }),
          ...(runId !== undefined && { runId }),
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
