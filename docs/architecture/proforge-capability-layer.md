# ProForge Dual-Purpose Architecture — Maintainer Guide

ProForge is exposed through one **Core Capability Layer** (single source of truth) consumed by two
runtimes — in-app (browser) and external AI agents (MCP) — with no business-logic duplication.

## The three layers

```
END-USER          Global Copilot · ProForge UI · future in-app AI
                       │ direct in-process calls (browser adapter)
CORE CAPABILITY   services/proForge/proForgeCapabilityLayer.ts   ← SSOT
   runStage · getHistory · applyEdits · ragQuery · getSupervisorStatus
   (Zod validation · permission gate · structured logging · ProForgeError)
                       │ ProForgeCapabilityPorts
   ┌───────────────────┼────────────────────┐
 Browser adapter   Node adapter (MCP)    Pure core (no IO)
 Redux/IDB/        @google/genai +       applyReviewEdits · supervisor
 inferenceGateway  in-mem memory + file  types · lexical RAG · schemas
                       │
              .mcp/proforge-mcp-server/  (stdio MCP, 5 thin tools)
```

## Files

| Concern | File |
|---------|------|
| Ports + pure ops + synthetic agent context | `services/proForge/proForgeCapabilityCore.ts` |
| Zod schemas + `ProForgeError` | `services/proForge/proForgeCapabilitySchemas.ts` |
| Capability layer (5 ops, SSOT) | `services/proForge/proForgeCapabilityLayer.ts` |
| Browser adapter | `services/proForge/adapters/browserProForgeCapability.ts` |
| Node gateway (Gemini) | `services/proForge/adapters/nodeInferenceGateway.ts` |
| Node adapter (portable payload) | `services/proForge/adapters/nodeProForgeCapability.ts` |
| Stage→agent registry (shared) | `services/proForge/pipelineAgents/agentRegistry.ts` |
| MCP server | `.mcp/proforge-mcp-server/` (see its README) |

## Layering rule (do not break)

`proForgeCapabilityCore.ts`, `proForgeCapabilityLayer.ts`, and `proForgeCapabilitySchemas.ts` import
**only** types, pure modules, and the agent registry — never Redux, IndexedDB, or browser globals.
Environment specifics live in the two adapter factories. This is what lets the Node/MCP runtime reuse
the exact same capability code as the browser.

Two supporting changes make agents runtime-agnostic:
- `BaseAgent` resolves its `InferenceGateway` lazily (`getGateway()`), so importing an agent in Node
  with an injected `context.gateway` never pulls the browser-only `aiProviderService` chain.
- `proForgeMemoryBank` falls back to an in-process store when `indexedDB` is undefined.

## Trust levels

- **Browser adapter** trusts the live Redux project; gate is `() => featureFlags.enableProForge`.
- **Node/MCP adapter** treats the project payload as untrusted — every op re-validates with the Zod
  schemas before touching the layer; gate is `() => true` (running the server is the opt-in).

## Adding a new operation

1. Add input/output Zod schema(s) to `proForgeCapabilitySchemas.ts`.
2. Add the method to `ProForgeCapabilityLayer` (validate → `assertEnabled` → `run()` wrapper → ports).
3. If it needs IO, add a port method to `ProForgeCapabilityPorts` and implement it in **both** adapters.
4. Add a thin MCP tool in `.mcp/proforge-mcp-server/src/tools/` and register it in `index.ts`.
5. Add unit tests (`tests/unit/proForge/proForgeCapabilityLayer.test.ts`) + extend the MCP smoke test.

## Verification

- Unit: `pnpm exec vitest run tests/unit/proForge tests/unit/copilot`
- MCP round-trip: `cd .mcp/proforge-mcp-server && npm install && npm run smoke`
