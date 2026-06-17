# XState machines

Workflow orchestration in StoryCraft Studio runs on XState v5 — the third state layer alongside
Redux (persistent domain state) and RTK Query (async AI). The decision and layering rules are in
[ADR 0009](adr/0009-xstate-workflow-orchestration.md). This doc catalogues the machines.

**Conventions**
- Machine definition: `features/<domain>/machine/<domain>Machine.ts` (+ `.types.ts`).
- React integration: `hooks/use<Domain>Machine.ts`.
- Side effects live only in **actors** (`fromPromise`) that wrap `services/*`. The machine definition
  is pure control flow → unit-tested headless with `createActor` + `.provide({ actors })`, no React,
  no live store.
- Machines **dispatch existing Redux slice actions**; they never become a second source of truth for
  domain data.

---

## 1. ProForge pipeline — **implemented** (additive; live wiring behind `enableProForgeXState`)

`features/proForge/machine/proForgeMachine.ts` formalizes the 8-stage human-in-the-loop pipeline that
`services/proForge/proForgeOrchestrator.ts` implements imperatively.

**States:** `idle → preparing → running.{preStageSnapshot → executingStage → supervising → gate →
(retrying | awaitingReview)} → running.{applyingEdits → advancing} → (completed | failed) ` plus
`aborting → aborted`. `ABORT` is handled on the `running` parent (cancels the active actor).

**Gate order (parity with the orchestrator):** `canRetry` → `intakeHardFail` (intake quality < 30,
no retry left) → human `awaitingReview`. Editing stages route review through `applyingEdits`; advisory
stages (production/publishing/analytics) skip straight to `advancing`.

**Actors (injected):** `snapshot`, `runStage` (loads the stage agent via `pipelineAgents/agentRegistry`),
`supervise` (`SupervisorAgent.evaluate`, heuristic — no AI), `applyEdits`
(`applyReviewEdits.planAcceptedManuscriptEdits` → `projectActions.updateManuscriptSection`, so edits
stay redux-undo-reversible), `restore` (version-control snapshot restore).

**Redux bridge (P4b):** `useProForgeMachine` subscribes the actor and, on each relevant transition,
dispatches the same `proForgeSlice` actions the class dispatches today (`stageStarted`,
`stageCompleted`, `stageFailed`, `submitStageReview`, `pipelineCompleted`, …) so existing ProForge UI,
selectors, and IDB run-history persistence are unchanged. `useProForgeOrchestrator` becomes a façade:
flag on → machine; flag off → existing class (fallback) — identical return shape.

**Tests:** `tests/unit/proForgeMachine.test.ts` — happy path, retry, intake hard-fail, non-editing
skip, abort, rollback.

---

## 2. Voice pipeline — **design only** (deferred)

Wraps the engine lifecycle (`isAvailable → initialize → use → dispose`), permission/download gating,
and cancellation currently spread across `useVoice`/`usePushToTalk`/`VoiceCommandService` (the
single-flight guard, C-P1).

**Proposed states:** `idle → requestingPermission → (denied | downloadingModel → ready) → listening →
processingSTT → dispatchingIntent → speakingTTS → idle`, with `error` recovery and `cancelled`
reachable from everywhere; `ecoMode` as a flag-guarded parallel variant.

**Actors wrap, don't reimplement:** Web Speech event plumbing and worker/WASM handling
(`wasmSttEngine`, `sileroVadEngine`) become actors. Intent dispatch goes through `runCommandById` +
`appStoreRef`. **Never log transcripts.** E2E reads the existing `voiceTestSeam` harness, so actors
must honor injected mocks the same way.

**Starting scope when greenlit:** model permission + download + listen + cancel first; add TTS/eco as
later parallel states. **Risk:** mic-permission + media-stream lifecycle is browser-flaky — keep it
behind `enableVoiceSupport`/`enableVoiceWasm`.

---

## 3. Global Copilot session — **design only** (deferred)

One `copilotSessionMachine` with a parametrized `generating` state (the action type — Continue,
Improve, Tone, Dialogue, Brainstorm, Synopsis, Grammar, Critic, Plot-Hole, Consistency — lives in
context), invoking an RTK Query / `useWorldScriptAI` streaming actor.

**Proposed states:** `awaitingInput → assemblingPrompt → streaming → previewing →
(applying | annotating | discarded)`, plus `retrying` (uses the `aiRetry` transient-error taxonomy)
and `error`.

**Same pattern as ProForge:** services-as-actors, Redux as the read-model. Copilot session state stays
ephemeral (`copilotSlice`, not persisted, not undo-wrapped). Apply-to-chapter dispatches
`projectActions` via `actionApplier` (the ≥70 %-length gate), so it remains redux-undo-reversible.

**When to adopt:** after the ProForge machine proves the pattern in production. Initial scope = the
streaming + retry + apply core for Continue/Improve; fold the other actions in by parametrization.

---

## Testing pattern

```ts
import { createActor, fromPromise, waitFor } from 'xstate';
const machine = someMachine.provide({ actors: { runStage: fromPromise(async () => mockResult) } });
const actor = createActor(machine, { input }); actor.start();
actor.send({ type: 'START' });
await waitFor(actor, (s) => s.matches({ running: 'awaitingReview' }));
expect(actor.getSnapshot().context.currentStage).toBe('intake');
```

Drive events, assert `state.value` / `context`. No React, no store, fully deterministic — keep the
existing slice/selector tests as the behavior-parity oracle during any migration.
