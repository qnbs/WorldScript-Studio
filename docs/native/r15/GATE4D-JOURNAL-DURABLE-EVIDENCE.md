# Gate 4D slice B PR 1 — journal durable promotion evidence

Owner: QNB-11 / #359. Base: `main` @ `0f765753d76a8420ca6bd2d8170200cf3f3ef1cf` (post–PR #958).

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Scope

Headless durable promotion for migration journal manifest and page generations (§10.1.1) using
Gate 3 §9 staging/promotion mechanics, plus an in-process `with_fence` serialization boundary.

## APIs introduced

| Surface | Role |
|---------|------|
| `durable::stage_and_promote_envelope` | Promote a pre-sealed WSR1 envelope without re-entering `seal_record` |
| `journal::promote_manifest` | Seal via `JournalManifest::seal`, promote, readback via `JournalManifest::open` |
| `journal::promote_manifest_fenced` | `with_fence` + `promote_manifest` |
| `journal::promote_page` | `JournalPage::seal` + promote + `JournalPage::open` readback |
| `journal::load_manifest_generation` | Load one manifest generation from a journal record directory |
| `journal::with_fence` / `acquire_journal_durable_guard` | Mutex + `assert_fence` before I/O |

## Bootstrap revision 0

- Sealing: `JournalManifest::seal` → `seal_journal_manifest_bootstrap` (unchanged contract path).
- Durability: `stage_and_promote_envelope` (never `stage_and_promote` / `seal_record` for gen 0).
- Proof: `gate4d_journal_durable_test::bootstrap_manifest_revision_zero_durable_roundtrip`.

## Non-bootstrap manifest

- Sealing: `JournalManifest::seal` → `seal_record` for `journal_revision > 0`.
- Durability: same envelope promotion path; immutable generation refusal preserved.
- Proof: `non_bootstrap_manifest_revision_promotes_and_refuses_overwrite`.

## Page durability

- Sealing: `JournalPage::seal` (generation > 0 per existing counter rules).
- Proof: `journal_page_durable_roundtrip`.

## `with_fence` semantics

- Process-wide mutex serializes journal durable mutations (single-process stand-in only).
- `assert_fence` runs before any filesystem operation in fenced entrypoints.
- Proofs: `stale_fence_rejects_before_durable_io`, `with_fence_holds_mutex_across_critical_section`.

## Fault / refusal evidence

- Stale fence → `MigrationExecutionError::StaleMigrationOwner`, zero `create_new` calls (CountingFs).
- Duplicate generation → `StageFailureKind::GenerationExists` (Gate 3 semantics).

## Explicit non-goals (this PR)

- Root `LiveMigration` binding update — **deferred** (Slice B2).
- Restart/reconciliation for manifest-ahead-of-root — **deferred**.
- Cross-process lease CAS — **deferred**.
- Mixed-key inventory conversion — **deferred** (Slice C+).
- TypeScript/Tauri wiring, production authority switch, Gate 4E/5/6.

## Tests

Integration: `crates/worldscript-secure-storage/tests/gate4d_journal_durable_test.rs` (5 cases).

Gate 4D overall status: **IN PROGRESS** (journal durable I/O only; not terminal).
