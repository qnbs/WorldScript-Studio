# Gate 4D slice A — migration journal execution state

Owner: QNB-11 / GitHub #359 under program QNB-168 / #922 / #445. Predecessor: Gate 4C journal codec (PR #956).

This slice adds headless Core **execution state** for §10.3 — phase ordering, fence/revision checks,
authoritative manifest revision selection against `LiveMigration`, checkpoint revision bumps, and
terminal `DONE` / `RECOVERY_REQUIRED` transitions. It does **not** include durable journal I/O,
record conversion, root live-migration binding updates, cross-process lease CAS, or production wiring.

## Acceptance matrix

| Requirement | Implementation | Focused proof |
|---|---|---|
| Root-bound manifest digest | `assert_live_binding(..., manifest_content_digest)` | `live_binding_requires_exact_manifest_digest_and_revision` |
| Exact root-bound journal revision | `authoritative_manifest_revision` | rejects `<`, accepts `==`, debris `>` |
| Phase transition revision bump | `transition_phase` | `transition_phase_bumps_revision_on_forward_change` |
| Terminal `RECOVERY_REQUIRED` | `mark_recovery` validates source phase + terminal guard | `mark_recovery_refuses_unsupported_source_phase` |
| Checkpoint cursor bounds | `JournalCheckpointCursor` | empty + out-of-range + regressive tests |
| Unsupported phase idempotence | `allows_phase_transition` | `happy_path_phase_sequence_is_forward_only` |
| `PREPARE` ordinary writes (§10.3) | `ordinary_mutating_writes_admitted` | `recovery_and_done_are_terminal_and_prepare_admits_writes` |

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Deferred (later 4D slices)

Durable manifest/page persistence, `with_fence` adapter integration, inventory execution, mixed-key
record conversion, root/catalog commit ordering, and crash-injection around physical durability boundaries.
