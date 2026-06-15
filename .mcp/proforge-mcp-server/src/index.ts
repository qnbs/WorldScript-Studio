#!/usr/bin/env node
/**
 * ProForge MCP Server — exposes the WorldScript ProForge Core Capability Layer to external AI agents.
 * QNBS-v3: A thin stdio MCP adapter. All business logic lives in the repo's Core Capability Layer
 * (services/proForge/proForgeCapabilityLayer.ts) via the Node adapter — this file only registers the
 * 5 tools and connects the transport.
 *
 * Run (from the repo root or this folder):
 *   GEMINI_API_KEY=… npx tsx src/index.ts --project ./examples/sample-project.json --history ./runs.json
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerApplyEdits } from './tools/applyEdits';
import { registerGetHistory } from './tools/getHistory';
import { registerGetSupervisorStatus } from './tools/getSupervisorStatus';
import { registerRagQuery } from './tools/ragQuery';
import { registerRunStage } from './tools/runStage';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'proforge',
    version: '1.0.0',
  });

  registerRunStage(server);
  registerApplyEdits(server);
  registerRagQuery(server);
  registerGetHistory(server);
  registerGetSupervisorStatus(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // QNBS-v3: stderr only — stdout is reserved for the MCP JSON-RPC stream.
  process.stderr.write('ProForge MCP server ready (stdio).\n');
}

main().catch((err) => {
  process.stderr.write(`ProForge MCP server failed to start: ${String(err)}\n`);
  process.exit(1);
});
