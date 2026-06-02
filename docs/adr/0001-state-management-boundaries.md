# ADR 0001 — State-management boundaries: Redux Toolkit vs Zustand

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, state, recurring-audit-question

## Context

Successive audits keep re-raising "why two state libraries?" as a perceived P0 risk. The codebase
deliberately runs **Redux Toolkit** and **Zustand** side by side. The boundary is real and stable,
but it lived only as prose in `CLAUDE.md`. This ADR promotes it to a decision record so it stops
being re-litigated, and so new contributors know which store a piece of state belongs in.

A third state framework is explicitly out of scope.

## Decision

State is partitioned by **lifetime and ownership**, not by feature:

| Concern | Store | Rationale |
|---|---|---|
| **Persisted domain data** (project, manuscript, characters, world, plot connections/subplots, settings, version history) | **Redux Toolkit**, feature-sliced under `features/*` | Needs serialisation to IndexedDB, time-travel **undo** (`redux-undo`, 100-step on the `project` slice), and middleware-driven side effects. |
| **Cross-cutting runtime state** that is derived/coordinated but not user-content | **Redux** slices (`status`, `featureFlags`, `analytics`, `proForge`, `lora`, `voice`, `plotBoard` viewport) | Shared across many views; benefits from selectors + devtools. Note: `plotBoard`, `proForge`, `lora`, `voice` are **not** undo-wrapped. |
| **Ephemeral UI state** (command-palette open, cross-project-search open, Flow Mode) | **Zustand** — `app/transientUiStore.ts` | Short-lived, view-local-ish, must **not** pollute undo history or trigger persistence. A Redux slice here would add boilerplate and risk accidental persistence. |

**Rules of thumb for contributors:**
1. Will it be saved to disk or need undo? → **Redux** (`features/<domain>/`).
2. Is it transient UI chrome that vanishes on reload and must never be undoable? → **Zustand** (`transientUiStore`).
3. Side effects (auto-save, Codex extraction, DuckDB dual-write, analytics) live in
   `app/listenerMiddleware.ts` via `addDebouncedListener` — **never** in components or hooks.
4. Read with the typed hooks `useAppSelector` / `useAppSelectorShallow`; never subscribe to the raw store.

## Consequences

- **Positive:** Undo history stays clean (UI toggles don't appear in it); persistence is opt-in by
  slice; the boundary is now testable as a convention (a transient key showing up in a persisted
  slice is a review smell).
- **Negative:** Two mental models. Mitigated by this ADR + the decision table.
- **Rejected alternative — consolidate onto Redux only:** would force ephemeral UI flags through
  reducers/actions/selectors and risk leaking them into `redux-undo` history or IndexedDB. The
  boilerplate-to-value ratio is poor for state that never persists.
- **Rejected alternative — consolidate onto Zustand only:** loses `redux-undo`, the listener
  middleware side-effect pipeline, and RTK devtools/selectors that the domain layer relies on.

## References

- `CLAUDE.md` § State Management
- `app/transientUiStore.ts`, `app/listenerMiddleware.ts`
- [[0002-local-ai-stack-layering]]
