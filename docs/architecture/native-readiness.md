# Native-Readiness Scorecard

First instance of the recurring check defined in `docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md` §7.4.5 (checked at architecture-changing PRs and major CEF wave exits) and §7.4.7 (part of the CEF-Stable admission gate). Wave 1 deliverable: "produce the first Native-Readiness/UI-vs-domain-state scorecard" (§3126).

**A `DEBT` result is allowed during migration but must have an owner** (§7.4.5). This scorecard is scored honestly against the codebase as it stands at each snapshot below — it is not aspirational.

## Snapshot: Wave 1 PR A (`packages/desktop-contracts` contracts only, before migration)

Owner roles below use `docs/cef/OWNERSHIP.yaml`'s existing taxonomy (`desktop-architecture`, `cef-runtime`, `rust-core`, `desktop-security`) — a wave reference alone is not an owner.

| Check | Result | Owner | Notes |
|---|---|---|---|
| Domain logic renderer-neutral | DEBT | desktop-architecture | Product logic (thunks, business rules) still lives in Redux/React. No extraction attempted yet — Wave 5+ scope. |
| Critical behavior headless-testable | DEBT | desktop-architecture | Some services (`fsCore.ts`, thunks) are already Vitest-testable without a DOM; most business logic is still coupled to React hooks/components — Wave 5+ scope. |
| Canonical data outside UI state | PASS (partial) | — | `docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` (this wave) confirms domain data (`project`, `sceneComments`, `progressTracker`, etc.) is already separated from Presentation/UI slices — it just isn't core-owned yet (see "Domain logic renderer-neutral" above). |
| Browser APIs adapter-contained | DEBT | desktop-architecture | Out of Wave 1 scope — no browser-API (localStorage/matchMedia/service-worker) audit performed this wave; not yet scheduled to a specific wave. |
| Platform APIs adapter-contained | DEBT — in progress | desktop-architecture (Wave 1 PR B) | `packages/desktop-contracts`'s `DesktopPlatform` contract and both reference adapters exist (this PR), but the 14 files identified in `docs/cef/TAURI-COUPLING-INVENTORY.md` still import `@tauri-apps/*` directly. Re-score to PASS once PR B (`services/desktopPlatform.ts` + migration) merges and `pnpm run guardrail:desktop-imports` is green. |
| Stable semantic commands/events | DEBT | desktop-architecture | No semantic command layer exists yet (roadmap §83, explicitly deferred: "do not force a full command-system rewrite before CEF needs it"); not yet scheduled to a specific wave. |
| No duplicate business rule in JS/native | PASS | — | No Rust-side duplication of JS business rules exists today; the small set of native commands (LoRA training, Pandoc conversion, TaskSupervisor) are each single-sourced in Rust with no JS re-implementation. |
| Durable schema UI-independent | PASS (partial) | — | `Settings`/`StoryProject` types are plain, framework-independent TypeScript interfaces (`types.ts`) — not React-coupled. Storage backend selection (`StorageBackend`) already abstracts IndexedDB vs. Tauri filesystem. |
| Error taxonomy UI-independent | DEBT | desktop-architecture | Error handling is inconsistent across services — some throw typed errors (`LocalServerError`), most throw generic `Error`. No unified taxonomy audited this wave; not yet scheduled to a specific wave. |
| Task semantics UI-independent | DEBT | cef-runtime (Wave 4) | `DesktopTasks` facet (this PR) names/types the existing native commands, but their result shapes are not yet a stable, versioned contract — that's Wave 4's typed-IPC-v1 scope. |

**Overall**: 3 PASS (2 partial), 7 DEBT, every DEBT row has a named owner role (per `docs/cef/OWNERSHIP.yaml`), not just a wave reference. No unowned high-impact debt.

## Next scoring checkpoint

Re-score this table when Wave 1 PR B (`services/desktopPlatform.ts` + the 14-file migration + `check-tauri-import-boundary.mjs` guardrail) merges, to confirm "Platform APIs adapter-contained" genuinely flips to PASS — verified by the guardrail script reporting zero violations, not just asserted here.
