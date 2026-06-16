/**
 * Shared MCP tool-response helpers.
 * QNBS-v3: Standardizes success/error envelopes so every ProForge tool returns consistent,
 * machine-parseable JSON content and maps ProForgeError codes to structured tool errors.
 */

import { z } from 'zod';
import { ProForgeError } from '../../../../services/proForge/proForgeCapabilitySchemas';

// QNBS-v3: Tool input shapes use the SERVER's zod (the same instance the MCP SDK uses), NOT the
// repo's patched zod — passing cross-instance schemas into registerTool can break the SDK's
// schema handling. The capability layer re-validates payloads internally with the repo's zod.
export const projectShape = z
  .object({
    projectId: z.string(),
    title: z.string().optional(),
    logline: z.string().optional(),
    manuscript: z
      .array(
        z.object({
          id: z.string(),
          title: z.string().optional(),
          content: z.string().optional(),
        }),
      )
      .optional(),
    characters: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
    worlds: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
    memoryEntries: z
      .array(z.object({ category: z.string(), key: z.string(), content: z.string() }))
      .optional(),
    config: z.unknown().optional(),
  })
  .describe("Portable WorldScript project payload. Omit to use the server's --project file.");

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Success envelope — pretty-printed JSON of the op result. */
export function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Error envelope — ProForgeError → structured code/message; everything else → INTERNAL. */
export function fail(err: unknown): ToolResult {
  if (err instanceof ProForgeError) {
    return {
      content: [{ type: 'text', text: JSON.stringify(err.toResult(), null, 2) }],
      isError: true,
    };
  }
  // QNBS-v3 (CodeAnt #1–#3): unexpected (non-ProForgeError) failures get a GENERIC client message;
  // the real detail goes to stderr only (operator console — stdout is the MCP JSON-RPC stream).
  // ProForgeError messages above are our own validation/text and safe to surface; arbitrary errors
  // (provider HTTP, fs, etc.) might carry incidental detail, so we don't echo them to the client.
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[proforge-mcp] internal error: ${detail}\n`);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal error' } }, null, 2),
      },
    ],
    isError: true,
  };
}
