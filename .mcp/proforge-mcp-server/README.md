# ProForge MCP Server

Exposes the WorldScript Studio **ProForge** 8-stage agentic editing pipeline to external AI agents
(Claude Desktop, Cline, Cursor, GitHub Copilot, Kimi, …) over the
[Model Context Protocol](https://modelcontextprotocol.io).

This server is a **thin adapter**. All business logic lives in the repo's single source of truth —
[`services/proForge/proForgeCapabilityLayer.ts`](../../services/proForge/proForgeCapabilityLayer.ts) —
consumed here through the Node adapter
([`adapters/nodeProForgeCapability.ts`](../../services/proForge/adapters/nodeProForgeCapability.ts)).
The same Core Capability Layer powers the in-app Global Copilot, so external agents and in-app
features share identical behaviour with zero logic duplication.

## Architecture

```
AI agent ──stdio MCP──> ProForge MCP server (this folder)
                              │ thin tool adapters
                              ▼
            ProForge Core Capability Layer (services/proForge/) ── SSOT
                              │ Node ports
                              ▼
   Node InferenceGateway (@google/genai) · in-process memory bank · file run-history
```

Because WorldScript is a backend-less PWA, this server cannot read the browser's live IndexedDB
project. It operates on a **portable project payload** passed per call (`project` argument) or loaded
once at startup (`--project <file>`). See [`examples/sample-project.json`](./examples/sample-project.json).

## Tools

| Tool | AI key? | Description |
|------|:------:|-------------|
| `proforge_run_stage` | **yes** | Run one pipeline stage agent (`intake`…`analytics`) + heuristic supervisor gate. |
| `proforge_apply_edits` | no | Offset-safe application of accepted edits to manuscript text (`dryRun` supported). |
| `proforge_rag_query` | no¹ | Retrieve relevant memory-bank entries (lexical / semantic / hybrid). |
| `proforge_get_history` | no | List completed/aborted runs (requires `--history <file>`). |
| `proforge_get_supervisor_status` | no | Per-stage supervisor decisions for a run (requires `--history <file>`). |

¹ `semantic`/`hybrid` modes fall back to lexical in Node when no embedding model is available.

## Environment

| Var | Purpose |
|-----|---------|
| `GEMINI_API_KEY` (or `WORLDSCRIPT_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) | Required only for `proforge_run_stage`. Never logged, never bundled. |

CLI flags: `--project <file>` (default payload), `--history <file>` (run-history JSON store).

## Run

This server reuses the repo's TypeScript sources and their dependencies (`zod`, `@google/genai`),
so it must live inside the WorldScript repo. Only the MCP SDK + `tsx` are installed locally.

```bash
cd .mcp/proforge-mcp-server
npm install            # installs @modelcontextprotocol/sdk + tsx
npm run smoke          # round-trip self-test (no API key needed)

# Start the server:
GEMINI_API_KEY=… npx tsx src/index.ts --project ./examples/sample-project.json --history ./runs.json
```

## Client configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "proforge": {
      "command": "npx",
      "args": ["tsx", "src/index.ts", "--project", "./examples/sample-project.json"],
      "cwd": "/absolute/path/to/WorldScript-Studio/.mcp/proforge-mcp-server",
      "env": { "GEMINI_API_KEY": "your-key-here" }
    }
  }
}
```

### Cline / Cursor / generic `mcpServers`

```json
{
  "mcpServers": {
    "proforge": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/WorldScript-Studio/.mcp/proforge-mcp-server/src/index.ts"],
      "env": { "GEMINI_API_KEY": "your-key-here" }
    }
  }
}
```

## Trust & safety

- The Node adapter treats the project payload as **untrusted input** — every op re-validates with the
  repo's Zod schemas (`proForgeCapabilitySchemas.ts`) before touching the capability layer.
- No filesystem writes occur outside the explicit `--history <file>`.
- API keys are read from the environment only; they are never written to logs or responses.
- Errors are returned as structured `{ error: { code, message, details? } }` envelopes
  (`code ∈ VALIDATION | PERMISSION_DENIED | NOT_FOUND | STAGE_FAILED | INTERNAL`).
