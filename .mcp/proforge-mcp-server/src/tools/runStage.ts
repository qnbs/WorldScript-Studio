/**
 * MCP tool: proforge_run_stage — execute one ProForge pipeline stage (AI-backed) + supervisor gate.
 * QNBS-v3: Thin adapter — delegates to the Core Capability Layer's runStage. Requires an AI key.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveCapability } from '../capability';
import { fail, ok, projectShape } from './shared';

export function registerRunStage(server: McpServer): void {
  server.registerTool(
    'proforge_run_stage',
    {
      title: 'Run a ProForge pipeline stage',
      description:
        'Execute a single ProForge pipeline stage agent against the manuscript and return its ' +
        'review items, metrics, raw output, and the heuristic supervisor decision. Stages: ' +
        'intake, structural, lineProse, copyEdit, proof, production, publishing, analytics. ' +
        'Requires GEMINI_API_KEY (or WORLDSCRIPT_API_KEY) in the server environment.',
      inputSchema: {
        project: projectShape.optional(),
        stage: z.enum([
          'intake',
          'structural',
          'lineProse',
          'copyEdit',
          'proof',
          'production',
          'publishing',
          'analytics',
        ]),
        config: z.unknown().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ project, stage, config, dryRun }) => {
      try {
        const { cap, payload } = await resolveCapability(project);
        const result = await cap.runStage({
          stage,
          projectId: payload.projectId,
          ...(config !== undefined ? { config } : payload.config ? { config: payload.config } : {}),
          ...(dryRun !== undefined && { dryRun }),
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
