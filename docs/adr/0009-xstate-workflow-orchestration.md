# ADR 0009 — XState for complex workflow orchestration (Redux + RTK Query + XState)

- **Status:** Accepted (ProForge machine landed additive; live wiring staged behind a gate)
- **Date:** 2026-06-17
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, state, workflows, xstate, proforge, voice, copilot

## Context

Three workflows in the app are long-running, multi-step, and human-in-the-loop: the **ProForge**
8-stage editing pipeline, the **Voice** command lifecycle, and the **Global Copilot** AI session.
Today each is an imperative orchestrator: `services/proForge/proForgeOrchestrator.ts` is a class that
hand-rolls a state machine (per-stage snapshot → run agent → supervisor gate with retry + intake
hard-fail → human review → apply edits → advance, plus rollback/abort) over an ephemeral Redux slice;
`VoiceCommandService` carries a single-flight guard and an implicit state machine across
`useVoice`/`usePushToTalk`; Copilot sessions thread streaming + retry + apply through ad-hoc hook
state. These hand-rolled machines enumerate states the type system already names (`StageStatus`,
`PipelineRunStatus`) and are hard to unit-test without a live store, easy to drive into impossible
states, and not visualizable.

[[0001-state-management-boundaries]] set the Redux-vs-Zustand boundary (persistent domain state in
Redux Toolkit, ephemeral UI in Zustand). `app/aiApi.ts` already adds RTK Query for AI side effects.
Neither is the right home for *orchestration* of multi-step flows with guards, retries, and human
gates — that logic currently leaks into services, hooks, and slice reducers.

## Decision

Adopt **XState v5** (`xstate` + `@xstate/react`) as the **third** state layer, dedicated to
orchestrating complex multi-step workflows. The layering and ownership rules:

| Concern | Layer |
|---|---|
| Persistent domain data (manuscript, characters, plot, …) | **Redux Toolkit** (`project` slice, undoable) — unchanged, [[0001-state-management-boundaries]] |
| Synchronous local mutations | **Redux reducers** |
| Async AI generation (request/response, cache, status) | **RTK Query** (`aiApi`) |
| Multi-step workflow orchestration (guards, retries, rollback, human gates, cancel) | **XState** (ProForge; later Voice, Copilot) |
| Ephemeral UI (palette open, drawers, flow mode) | **Zustand** / local `useState` |

**Synchronization contract — the machine never becomes a second source of truth for domain data:**

- **XState → Redux:** machine transitions dispatch the *existing* slice actions; Redux stays the
  read-model the UI binds to. For ProForge the `proForgeSlice` shape is the integration contract, so
  no UI component changes when the machine replaces the class.
- **XState → RTK Query / services:** AI stages run inside `fromPromise` actors that call the AI layer
  (or `services/ai` for streaming), keeping caching/retry/dedup in one place.
- **Redux → XState:** actors read the live store via `appStoreRef` (the established pattern) and
  receive snapshots, not subscriptions, so machines stay pure.
- **Side effects live only in actors.** The machine definition is pure control flow — guards,
  transitions, context assigns — and is unit-tested headless via `createActor` + `.provide({ actors })`
  with no React and no live store. Offline-first and local-AI paths are unaffected: actors invoke the
  same `localAiFacade`/worker pools and honor `assertCloudAiAllowed`.

**Placement:** machine definitions in `features/<domain>/machine/`; React integration hooks in
`hooks/use<Domain>Machine.ts`; actors wrap `services/*` (never inline service logic).

**Rollout — incremental and flagged.** ProForge is first because it is already an explicit state
machine. The machine + injectable actors + headless tests land **additive** (not imported by app
code, zero bundle impact). The live façade — `useProForgeOrchestrator` delegating to a
`useProForgeMachine` when `enableProForgeXState` is on, with the existing class as fallback — is a
separate step, verified 1:1 against the existing ProForge tests before the flag defaults on. Voice
and Copilot machines are **designed but deferred** (see [[../XSTATE-MACHINES]]); they adopt the same
actor/read-model pattern once ProForge proves it in production.

## Consequences

- **Positive:** retry/gate/rollback/abort become declarative and guard-tested without a live store;
  `@xstate/inspect` visualization; impossible states eliminated (a stage can't be "executing" and
  "awaiting review" at once); orchestration logic leaves services/hooks/reducers for one inspectable
  place. The pattern generalizes to Voice and Copilot.
- **Negative:** a third state library to learn; a temporary period where the imperative orchestrator
  and the machine coexist behind the flag; contributors must keep the "machine dispatches existing
  slice actions, never owns domain data" rule or risk a second source of truth.
- **Rejected — keep imperative orchestrators:** the status quo; untestable without a live store,
  prone to impossible states, orchestration logic stays smeared across layers.
- **Rejected — model workflows inside Redux (sagas/listener middleware):** RTK listener middleware can
  sequence effects but has no first-class states/guards/visualization; complex human-gated flows
  become a tangle of flags. XState is purpose-built for exactly this shape.
- **Rejected — put orchestration in RTK Query:** RTK Query is for request/response caching, not
  multi-step human-in-the-loop control flow.

## References

- [[../XSTATE-MACHINES]] — machine catalogue: ProForge (implemented), Voice + Copilot (designs).
- [[0001-state-management-boundaries]] — the Redux/Zustand boundary this extends.
- `features/proForge/machine/` — the implemented machine + types; `tests/unit/proForgeMachine.test.ts`.
