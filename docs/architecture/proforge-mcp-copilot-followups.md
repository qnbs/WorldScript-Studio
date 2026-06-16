# ProForge MCP + Global Copilot — Follow-up Backlog (CodeAnt PR #107)

> **Status:** ✅ **ALL 6 ITEMS COMPLETED** on `feat/proforge-dual-purpose-mcp-copilot` (no separate
> branch needed — fixed in place on PR #107). Each is covered by tests (unit + MCP smoke) and the
> resolving change is noted per item below.
> **Scope:** 8 CodeAnt.ai findings, all on code introduced by PR #107 (`feat/proforge-dual-purpose-mcp-copilot`).
> **Source PR:** https://github.com/qnbs/WorldScript-Studio/pull/107
>
> Each item below was **validated against the current code** (not just trusting the bot). CodeAnt's
> severity is shown alongside a **re-rated severity** for *this* codebase (a local stdio dev tool +
> an offline PWA), with the reasoning.

## Quick triage table

| # | Area | File | CodeAnt | Re-rated | Verdict | Effort |
|---|------|------|---------|----------|---------|--------|
| 5 | MCP memory re-seed duplicates | `.mcp/.../src/capability.ts` | Critical | **High** | Confirmed bug | S |
| 7 | Copilot stuck `streaming` on close | `hooks/useGlobalCopilot.ts` | Critical | **High** | Confirmed bug | XS |
| 4 | Import-time crash on bad `--project` | `.mcp/.../src/capability.ts` | Major | **Medium** | Confirmed bug | S |
| 6 | Empty-string `runId` → wrong run | `.mcp/.../tools/getSupervisorStatus.ts` + core | Major | **Medium** | Confirmed bug | XS |
| 8 | Disabling flag doesn't clear Copilot | `hooks/useSettingsView.ts` | Major | **Medium** | Confirmed | XS |
| 1–3 | Raw `err` in MCP responses/stderr | `.mcp/.../tools/*` + `index.ts` | Critical ×3 | **Low–Medium** | Partial (severity inflated) | S |

Total ≈ **half a day** including tests. Recommended single follow-up branch: `fix/proforge-mcp-copilot-codeant`.

---

## 1. [High] MCP memory bank re-seeds on every request → duplicate RAG results + unbounded growth

- **CodeAnt:** #5 (Critical, performance) — `.mcp/proforge-mcp-server/src/capability.ts:59`
- **Confirmed.** `resolveCapability()` calls `createNodeProForgeCapability(raw, …)` on **every** tool
  invocation. That factory loops `payload.memoryEntries` → `saveMemoryEntry(...)`, and
  `saveMemoryEntry` (`services/proForge/proForgeMemoryBank.ts`) mints a fresh id (`Date.now()` +
  `Math.random()`) into the process-global `memFallback` map when `indexedDB` is absent (always, in
  Node). So N `proforge_rag_query` calls seed N copies of the same lore → duplicate hits + memory bloat.
- **Root cause:** no caching of the per-payload capability, and non-idempotent seeding.
- **Fix (choose one, prefer A):**
  - **A — cache the capability per effective payload** in `capability.ts`: keep a `Map<string, Promise<ProForgeCapabilityLayer>>` keyed by a stable hash of the payload (e.g. `projectId` + JSON length, or a cheap hash), and return the cached instance. Seeding then runs once.
  - **B — make seeding idempotent** in `nodeProForgeCapability.ts`: derive a deterministic id per entry (`${projectId}:${category}:${key}`) and/or `clearProjectMemory(projectId)` before re-seeding.
- **Tests:** extend `.mcp/.../scripts/smoke.ts` (or a new `tests/unit/proForge/nodeCapability.test.ts`)
  to call `ragQuery` twice and assert the result count does not grow.
- **Watch out:** keep the cache keyed so two *different* inline payloads don't collide.

---

## 2. [High] Copilot can get stuck in `streaming` when the panel is closed mid-response

- **CodeAnt:** #7 (Critical, logic error) — `hooks/useGlobalCopilot.ts` (the `close` callback, ~L141–144)
- **Confirmed.** `close()` calls `stop()` + `setOpen(false)` but never resets status. If `stop()`
  aborts the stream without firing `useWorldScriptAI`'s `onFinish`/`onError`, the slice stays
  `status: 'streaming'`, and `sendMessage`'s `if (!trimmed || status === 'streaming') return;`
  guard blocks **all** future sends until `clear()`.
- **Fix:** in `close()` (and `clear()` already calls `stop()`), when `status === 'streaming'`, also
  dispatch `copilotActions.finishLastAssistant()` + `copilotActions.setStatus('idle')`. Simplest:
  ```ts
  const close = useCallback(() => {
    stop();
    dispatch(copilotActions.finishLastAssistant());
    dispatch(copilotActions.setStatus('idle'));
    dispatch(copilotActions.setOpen(false));
  }, [dispatch, stop]);
  ```
- **Tests:** unit test on the slice/hook: set `status='streaming'`, call `close`, expect `status==='idle'`
  and that a subsequent `sendMessage` is not short-circuited.

---

## 3. [Medium] MCP server crashes at import time on a bad `--project` file (bypasses startup error handling)

- **CodeAnt:** #4 (Major, possible bug) — `.mcp/proforge-mcp-server/src/capability.ts:37–38`
- **Confirmed.** `startupPayload` runs `JSON.parse(readFileSync(cli.projectFile, 'utf8'))` at **module
  top level**. Tool modules import `../capability`, so a missing/malformed file throws during import —
  before `main().catch()` in `index.ts` is installed — yielding an ugly uncaught import-time crash
  instead of the intended `"ProForge MCP server failed to start: …"` message.
- **Fix:** defer the read. Make `startupPayload` lazy: store only the path at module load, and read it
  inside `main()` (or inside `resolveCapability` on first use) wrapped in try/catch that throws a clean
  `Error('Failed to load --project file <path>: <reason>')`. Keep `main().catch()` as the single exit point.
- **Tests:** smoke variant or unit test that points `--project` at a non-existent file and asserts a
  clean structured error (exit 1, message on stderr) rather than an import-time stack trace.

---

## 4. [Medium] Empty-string `runId` silently returns the most-recent run instead of erroring

- **CodeAnt:** #6 (Major, incorrect condition) — `.mcp/.../tools/getSupervisorStatus.ts` + core
- **Confirmed.** `runId: z.string().optional()` accepts `""`. The tool forwards it (`runId !== undefined`),
  and `selectRun(runs, runId)` (`proForgeCapabilityCore.ts`) plus `getSupervisorStatus`
  (`proForgeCapabilityLayer.ts`) use truthiness (`if (runId)`), so `""` is treated as "no id" → the
  latest run is returned and no `NOT_FOUND` is thrown.
- **Fix (do it in the core schema so every caller benefits):** change `runId` to `z.string().min(1).optional()`
  in **both** `getSupervisorStatusInputSchema` and `getHistoryInputSchema`
  (`services/proForge/proForgeCapabilitySchemas.ts`). Then `""` becomes a `VALIDATION` error, which is
  the correct, explicit behaviour. (No tool change needed once the schema rejects it.)
- **Tests:** extend `proForgeCapabilityLayer.test.ts` — `getSupervisorStatus({projectId, runId:''})`
  rejects with `code: 'VALIDATION'`.

---

## 5. [Medium] Disabling the `enableGlobalCopilot` flag doesn't end the active session

- **CodeAnt:** #8 (Major, incomplete implementation) — `hooks/useSettingsView.ts` (`enableGlobalCopilot` case)
- **Confirmed.** The handler only dispatches `setEnableGlobalCopilot(false)`. App unmounts the launcher,
  but the `copilot` slice (`isOpen`, `messages`, `status`) is untouched, so re-enabling later restores a
  stale (possibly `streaming`) panel. (Any in-flight stream is also not explicitly stopped, though unmount
  aborts the React side.)
- **Fix:** in the `'enableGlobalCopilot'` case, when turning **off**, also dispatch
  `copilotActions.setOpen(false)` + `copilotActions.clear()`. Import `copilotActions` in `useSettingsView`.
  ```ts
  case 'enableGlobalCopilot':
    dispatch(featureFlagsActions.setEnableGlobalCopilot(Boolean(value)));
    if (!value) {
      dispatch(copilotActions.setOpen(false));
      dispatch(copilotActions.clear());
    }
    break;
  ```
- **Tests:** unit test on `useSettingsView` (or a thin reducer test) — disabling the flag clears
  `copilot.messages` and sets `isOpen=false`.

---

## 6. [Low–Medium] MCP error responses / startup log forward raw `err` text

- **CodeAnt:** #1 (`tools/ragQuery.ts`), #2 (`tools/runStage.ts`), #3 (`index.ts`) — all Critical, security
- **Partially valid — severity inflated for this context.** The MCP server is a **local stdio process**:
  `stdout` carries the MCP JSON-RPC stream, `stderr` is the operator's own console. Error strings here are
  our own `ProForgeError`/validation messages or provider HTTP errors; **API keys are never placed in error
  text** (the Node gateway reads keys from env and never echoes them). So the real exposure is low. Still,
  returning a generic message for *unexpected* (non-`ProForgeError`) errors is good hygiene and cheap.
- **Fix (single shared change covers #1 + #2):** in `.mcp/.../src/tools/shared.ts` `fail()`, for
  non-`ProForgeError`, return a **generic** client message (`code: 'INTERNAL', message: 'Internal error'`)
  and write the real detail to **stderr** only (operator diagnostics). For **#3** (`index.ts`), keep a
  generic `"ProForge MCP server failed to start."` line on stderr; optionally include `err.message` (not
  the full stack) since stderr is operator-only — or gate verbose output behind a `DEBUG` env var.
- **Tests:** unit test `fail()` — a plain `Error('secret-ish detail')` produces a response whose text does
  **not** contain `'secret-ish detail'`.
- **Note:** this is the one cluster where CodeAnt's "Critical" over-rates the risk; document the decision
  in the fix commit so the rationale is preserved.

---

## Suggested execution order (one branch, one PR)

1. [ ] **#1** Cache capability per payload in `capability.ts` (+ smoke assertion) — biggest real win.
2. [ ] **#2** Reset Copilot status to idle on `close()` (+ slice test).
3. [ ] **#3** Defer `--project` read into a try/catch runtime path (+ bad-file test).
4. [ ] **#4** `runId: z.string().min(1).optional()` in both schemas (+ VALIDATION test).
5. [ ] **#5** Clear + close Copilot when the flag is disabled (+ test).
6. [ ] **#6** Generic `fail()` for unexpected errors + stderr-only detail; generic startup log.
7. [ ] Run `pnpm run lint && pnpm run typecheck`, `pnpm exec vitest run tests/unit/proForge tests/unit/copilot`, and `cd .mcp/proforge-mcp-server && npm run smoke`.
8. [ ] Reply to each CodeAnt thread on PR #107 citing the resolving commit; resolve all threads (0 unresolved).

**Acceptance:** all 6 items fixed at root cause with tests; CI green; CodeAnt threads resolved.
