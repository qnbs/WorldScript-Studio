# Gate 4D slice A — migration journal execution state

Owner: QNB-11 / GitHub #359 under program QNB-168 / #922 / #445. Predecessor: Gate 4C journal codec (PR #956).

This slice adds headless Core **execution state** for §10.3 — phase ordering, fence/revision checks,
authoritative manifest revision selection against `LiveMigration`, checkpoint revision bumps, and
terminal `DONE` / `RECOVERY_REQUIRED` transitions. It does **not** include durable journal I/O,
record conversion, root live-migration binding updates, cross-process lease CAS, or production wiring.

## Acceptance matrix

| Requirement | Implementation | Focused proof |
|---|---|---|
| Forward-only §10.3 phase order | `allows_phase_transition`, `transition_phase` | `happy_path_phase_sequence_is_forward_only` |
| Fence token on every mutation | `MigrationFence`, `assert_fence` | `stale_fence_is_refused_before_mutation` |
| Root-bound authoritative revision | `authoritative_manifest_revision`, `assert_live_binding` | `live_binding_rejects_ahead_revision_candidate` |
| Checkpoint revision bump + cursor | `checkpoint_progress` | `checkpoint_bumps_revision_and_moves_cursor` |
| Terminal refusal/success | `mark_recovery`, `mark_done`, `is_terminal_phase` | `recovery_and_done_are_terminal` |
| Ordinary write gate | `ordinary_mutating_writes_admitted` | `recovery_and_done_are_terminal` |

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Deferred (later 4D slices)

Durable manifest/page persistence, `with_fence` adapter integration, inventory execution, mixed-key
record conversion, root/catalog commit ordering, and crash-injection around physical durability boundaries.
