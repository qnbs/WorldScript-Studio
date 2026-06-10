/**
 * MCP tool: proforge_get_supervisor_status — per-stage heuristic quality-gate results for a run.
 * QNBS-v3: Reads recorded supervisor decisions from run history (no AI). No AI key required.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveCapability } from '../capability';
import { fail, ok, projectShape } from './shared';

export function registerGetSupervisorStatus(server: McpServer): void {
  server.registerTool(
    'proforge_get_supervisor_status',
    {
      title: 'Get ProForge supervisor status',
      description:
        'Return the per-stage SupervisorAgent decisions (pass/quality-score/reasons) for a run. ' +
        'Defaults to the most recent run; pass runId to target a specific one. Requires --history.',
      inputSchema: {
        project: projectShape.optional(),
        runId: z.string().optional(),
      },
    },
    async ({ project, runId }) => {
      try {
        const { cap, payload } = await resolveCapability(project);
        const result = await cap.getSupervisorStatus({
          projectId: payload.projectId,
          ...(runId !== undefined && { runId }),
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
