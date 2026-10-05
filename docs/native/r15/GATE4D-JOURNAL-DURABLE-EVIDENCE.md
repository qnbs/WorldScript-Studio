# Gate 4D slice B — journal durable promotion evidence

Owner: QNB-11 / #359. Base: `main` @ `5709ef95…` (post–PR #959); B1 hardening follows #959.

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Scope

Headless durable promotion for migration journal manifest and page generations (§10.1.1) using
Gate 3 §9 staging/promotion mechanics, plus an in-process `with_fence` serialization boundary.

## APIs introduced

| Surface | Role |
|---------|------|
| `durable::stage_and_promote_envelope` | Promote a pre-sealed WSR1 envelope without re-entering `seal_record` |
| `journal::JournalDurableContext` | Bundles `fs`, `key`, `dir`, and `WriteOperationId` for promote/load entrypoints |
| `journal::promote_manifest` (crate-private) | Seal, promote, readback via `JournalManifest::open` |
| `journal::promote_manifest_fenced` | Public mutation: `with_fence` + crate-private `promote_manifest` |
| `journal::promote_page` (crate-private) | `JournalPage::seal` + promote + `JournalPage::open` readback |
| `journal::promote_page_fenced` | Public page mutation: `with_fence` + crate-private `promote_page` |
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
- Proofs: `stale_fence_rejects_before_durable_io`; mutex exclusion via unit tests in
  `journal::durable::mutex_proof`:
  - `journal_durable_mutex_blocks_try_lock_while_guard_held` — guard holds `JOURNAL_DURABLE_MUTEX`;
  - `with_fence_holds_mutex_during_closure` — `with_fence` retains the guard through the callback body
    (`try_lock` → `WouldBlock` inside the closure, available after return). No sleeps or cross-thread races.
  - Proof tests hold a test-only `MUTEX_PROOF_TEST_SERIAL` for the full test body so the default parallel
    unit-test harness cannot cross-contaminate post-release availability checks.

## B1 hardening (post–#959)

- **R1 public fencing:** unfenced `promote_manifest` / `promote_page` are `pub(crate)`; external
  mutation uses `promote_manifest_fenced` and `promote_page_fenced` only.
- **R2 post-promotion errors (split):**
  - Post-promotion **read I/O** failure → `JournalDurableError::Stage` with `StageFailure.promoted == true`
    and promotion-time `staging` residue (B1 closed in #960).
  - Post-promotion **semantic open/verify** failure → `JournalDurableError::Journal` without an explicit
    promoted flag; retry may observe `GenerationExists`. B2 must define recovery/reconciliation when a
    durable generation exists but journal open refuses (acceptance criterion in gap matrix).
- **R4 stale caller manifest + matching fence:** B2-owned durable authority/reconciliation only; not
  expanded in B1 (#960).
- **R5 `key_epoch: 1` in journal `RecordMeta`:** existing B1 implementation convention for migration
  record envelopes in this slice; authoritative epoch alignment with root `active_key_epoch` and root
  binding advancement remain B2-owned (no value change without normative contract proof).

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

Integration: `crates/worldscript-secure-storage/tests/gate4d_journal_durable_test.rs` (4 cases).

Unit (mutex): `journal_durable_mutex_blocks_try_lock_while_guard_held` and
`with_fence_holds_mutex_during_closure` in `journal::durable::mutex_proof`.

Gate 4D overall status: **IN PROGRESS** (journal durable I/O only; not terminal).
