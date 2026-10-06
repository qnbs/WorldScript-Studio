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
| `journal::promote_manifest_fenced` | Public mutation: `with_fence` + R4 committed-binding check + crate-private `promote_manifest` |
| `journal::promote_page` (crate-private) | `JournalPage::seal` + promote + `JournalPage::open` readback |
| `journal::promote_page_fenced` | Public page mutation: `with_fence` + R4 committed-binding check + crate-private `promote_page` |
| `journal::assert_manifest_promote_authority` / `assert_page_promote_authority` | Pure R4 predicates: the caller's token against the root's committed `Option<&LiveMigration>` |
| `journal::assert_binding_successor` | Pure B2b-1 predicate: a binding advance is the CAS successor (same operation and fence, revision + 1) of the committed binding |
| `authority::advance_live_migration` | B2b-1: under `root_commit_mutex`, verify the successor and the durable manifest generation, then commit a root carrying the new binding |
| `authority::commit_journal_checkpoint` | B2b-2: under `root_commit_mutex`, read the committed binding, promote the owner's next manifest against it (R4), then advance the binding to that generation |
| `journal::load_manifest_generation` | Load one manifest generation from a journal record directory |
| `journal::load_authoritative_manifest` | Resume the generation the committed root names, then bind its exact envelope digest |
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
  expanded in B1 (#960). Closed against the committed binding by the R4 slice below.
- **R5 `key_epoch: 1` in journal `RecordMeta`:** existing B1 implementation convention for migration
  record envelopes in this slice; authoritative epoch alignment with root `active_key_epoch` and root
  binding advancement remain B2-owned (no value change without normative contract proof).

## Fault / refusal evidence

- Stale fence → `MigrationExecutionError::StaleMigrationOwner`, zero `create_new` calls (CountingFs).
- Duplicate generation → `StageFailureKind::GenerationExists` (Gate 3 semantics).

## B2a — root-bound durable resume selection

`load_authoritative_manifest` reads only the generation named by the committed `LiveMigration`.
The binding check uses the canonical content digest of those exact WSR1 envelope bytes
(`SHA-256("worldscript-r15/content/v1" || envelope)`). A durable `r+1` is not adopted.
`NotFound` for that exact generation is `JournalDurableError::Authority(RecoveryRequired)`.
Other I/O and authenticated-open failures keep their existing classes.

Proof: `gate4d_journal_durable_test` resume cases. B2a does not advance the root.

## R4 — promote-time caller authority

`promote_manifest_fenced` and `promote_page_fenced` take the root's committed
`Option<&LiveMigration>`. Under the journal mutex, after `assert_fence` and before any I/O, the
caller's token is compared with that binding (`assert_manifest_promote_authority`,
`assert_page_promote_authority`). A refusal is `JournalDurableError::Authority`, not a `Fence`
error, and creates no file. `assert_fence` alone only compared the caller's token with the
caller's own manifest, so a stale owner's self-consistent manifest/fence pair passed it and could
occupy a free generation slot that the committed owner then found as `GenerationExists`.

| Caller | Committed binding | Admitted / refusal |
|--------|-------------------|--------------------|
| manifest or page | none | Only bootstrap revision `0`; otherwise `LiveBindingMismatch` |
| manifest | names `(op, G, r)` | Only `(op, G, r + 1)` |
| page | names `(op, G, r)` | Only under manifest `(op, G, r)` |
| either | other `operation_id` | `LiveBindingMismatch` |
| either | other fencing generation | `StaleMigrationOwner` |
| either | revision below the admitted one | `StaleJournalRevision` |
| either | revision above the admitted one | `LiveBindingMismatch` |

Why only `r + 1`: §10.1.1 treats a durable `r + 1` as a candidate until the root advances, so a
durable `r + 1` does not make `r + 2` admissible. A root naming `u64::MAX` has no successor.

Boundary, stated so it is not read as more than it is:

- The committed binding is supplied by the caller, as it is for `load_authoritative_manifest`. R4
  refuses a stale pair against that binding at call time, inside the single-process mutex. It does
  not make a stale copy of the binding current, and it is not the cross-process lease CAS of §10.1.
- The binding's `manifest_digest` is not compared here: a caller's in-memory manifest has no
  envelope bytes. `load_authoritative_manifest` binds that digest on resume.
- No root read or write, no `r + 1` deletion, no directory enumeration, no sibling-generation read,
  no `key_epoch` change.

Proof: the R4 cases in `gate4d_journal_durable_test`, each asserting zero `create_new` calls and
no new generation on disk for a refusal, and `NoListFs` (no `list_dir`) for the admitted path.

## B2b-1 — authenticated root binding advance (`r → r+1`)

`authority::advance_live_migration` commits a root whose live-migration binding is the journal
owner's next revision (§5.4). Under `root_commit_mutex` it re-reads the committed root and requires
that root to bind a live migration, that the advance be the CAS successor of that binding
(`assert_binding_successor`: same `operation_id`, same fencing generation, `journal_revision + 1`),
and that the manifest generation it names be durable, authenticate under the journal key and hash
to the binding's `manifest_digest` (`load_authoritative_manifest`: exact path, no `list_dir`, no
sibling read). Only then does it commit a root that keeps the catalog, key route and active epoch,
swaps in the new binding and records the operation's own positive fence as `root_commit_evidence`
(an ordinary commit records fence `0` and keeps copying the binding forward unchanged).

| Advance | Result |
|---------|--------|
| root binds no live migration | `NoLiveMigration` |
| other `operation_id` | `LiveMigration(LiveBindingMismatch)` |
| other fencing generation | `LiveMigration(StaleMigrationOwner)` |
| revision at or below the committed one | `LiveMigration(StaleJournalRevision)` |
| revision beyond `committed + 1`, even if durable | `LiveMigration(LiveBindingMismatch)` |
| named generation absent | `Journal(Authority(RecoveryRequired))` |
| digest differs from the durable bytes | `Journal(Authority(LiveBindingMismatch))` |

The comparison is against the binding read from the root under the lock, never against a copy the
caller carries, so a stale owner that holds an older binding is refused (this carries the CodeAnt
disposition on #988 for the advance itself). The journal read takes no journal mutex and no journal
byte is written or deleted, so the root lock is the only lock taken. Because that read can see a
generation whose directory entry a concurrent promote has linked but not yet synced, the advance
syncs the journal directory before the root is published, so the root never names a manifest that a
crash could lose; the sync's durability is folded into `RootCommitted.directories`, and a failed
sync is `AuthorityError::Io { step: SyncJournal, .. }` with nothing committed. A caller-supplied key
route or epoch that differs from the committed root is `KeyRotationNotAdmitted`, as for any
catalog commit. Before step F the prior root and binding stay authority.

Boundary: nothing in the crate yet calls the advance except the B2b-2 checkpoint below, bind and
clear transitions are not implemented, and the promote functions called directly still receive their
committed binding from the caller; the checkpoint is the path that sources it from the root.

Proof: `gate4d_root_binding_test` (9 cases): the committed advance changes only the binding and
evidence and leaves every journal byte untouched; no bound migration; another operation, another
fence, the committed revision and a skipped revision; a wrong digest; an absent generation; a stale
owner after the root moved on; an ordinary commit keeping the advanced binding; the journal
directory is synced before the root pointer moves (recorded call order); a different key route or
epoch is refused.

## B2b-2 — journal-owner checkpoint under the root lock

`authority::commit_journal_checkpoint` is the §5.4 checkpoint: the journal owner's next manifest
revision is published and the root binding is advanced to it, under one `root_commit_mutex`. The
committed binding is read from the root, so `promote_manifest_fenced` checks the manifest (R4)
against the authenticated binding rather than a copy the caller carries; only the committed owner's
next revision is written and a stale owner is refused before any journal write. The binding is then
advanced to exactly that generation as B2b-1 does, using the digest of the promoted envelope. This
closes the CodeAnt disposition on #988 end to end.

Refusals that write no journal byte: no bound migration (`NoLiveMigration`), a different key route or
epoch (`KeyRotationNotAdmitted`, checked before the promote because a refusal after it would already
have left a candidate), a stale owner, another operation, the committed revision or a skipped
revision (`Journal(Authority(..))`), and a fence that disagrees with the manifest
(`Journal(Fence(..))`).

Crash windows: before the promote nothing changed; after the promote and before step F the root
still names `r` and revision `r + 1` is an unadopted candidate that B2a resumes past (tested with an
injected anchor `Prepare` fault); after step F the root names `r + 1`.

Lock order is the root lock, then the journal mutex inside the promote. Nothing in the crate takes
them the other way round, and the journal read inside the advance takes no journal mutex, so there is
no cycle; later callers must keep this order.

Boundary: a retry after the middle crash window meets `GenerationExists` for the candidate. Adopting
or discarding an existing candidate is R2B and is not done here. Nothing calls the checkpoint yet.

Proof: six cases in `gate4d_root_binding_test`: the checkpoint publishes and advances; no bound
migration; stale owner, another operation, the committed revision, a skipped revision and a fence
mismatch; a different key route or epoch; a failed root commit leaving the manifest as an unadopted
candidate, with the retry boundary; chained checkpoints and a repeated revision refused afterwards.

## Still residual after B2b-2

- Binding transitions other than the advance: bind (bootstrap) and clear (terminal), which belong to
  the Gate 4E/5 enable and commit sequences, and owner takeover with a new fence.
- R2B: adopting or discarding an existing candidate generation and recovery when the root-named
  envelope exists but semantic open refuses; it needs root writes and follows the binding
  transitions.
- The cross-process lease CAS.
- Root-bound `key_epoch` alignment: §8.3 fixes first-time enable at epoch 1 (the current constant),
  but the contract does not say which epoch seals the journal during rotation, so that needs a
  contract decision with the rotation slice.
- Mixed-key conversion, Gate 4E/5/6/7, production authority switch.

## Explicit non-goals (journal durable promotion)

- Root `LiveMigration` binding bootstrap and clear (the advance is covered by B2b-1 above).
- Adopting a manifest generation ahead of the root.
- Cross-process lease CAS.
- Mixed-key inventory conversion (Slice C+).
- TypeScript/Tauri wiring, production authority switch, Gate 4E/5/6.

## Tests

Integration: `crates/worldscript-secure-storage/tests/gate4d_journal_durable_test.rs` (4 promotion cases, 7 root-bound resume cases, and 9 R4 caller-authority cases).
Integration: `crates/worldscript-secure-storage/tests/gate4d_root_binding_test.rs` (9 B2b-1 binding-advance cases and 6 B2b-2 checkpoint cases).

Unit (mutex): `journal_durable_mutex_blocks_try_lock_while_guard_held` and
`with_fence_holds_mutex_during_closure` in `journal::durable::mutex_proof`.

Gate 4D overall status: **IN PROGRESS**. B2a resume selection, R4 promote-time caller authority,
the B2b-1 root binding advance and the B2b-2 journal checkpoint are in scope above; B2 is not
terminal.
