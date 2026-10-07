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
| `journal::publish_manifest_fenced` | B2b-3/B2b-4: the same authority and fence as `promote_manifest_fenced`, then the successor check against the committed generation, then one exact-path read of `generation-<r>`: absent → promote; present and identical (opens under the journal key with the key epoch a promote pins, decodes to the same manifest) → adopt with no write; anything else → `GenerationExists`, nothing written or removed |
| `journal::promote_page` (crate-private) | `JournalPage::seal` + promote + `JournalPage::open` readback |
| `journal::promote_page_fenced` | Public page mutation: `with_fence` + R4 committed-binding check + crate-private `promote_page` |
| `journal::assert_manifest_promote_authority` / `assert_page_promote_authority` | Pure R4 predicates: the caller's token against the root's committed `Option<&LiveMigration>` |
| `journal::assert_binding_successor` | Pure B2b-1 predicate: a binding advance is the CAS successor (same operation and fence, revision + 1) of the committed binding |
| `journal::assert_manifest_successor` | Pure B2b-4 predicate: a manifest is a valid successor of the manifest the root names (revision + 1, kept operation identity, allowed phase step, no cursor regression within a phase, frozen target key and inventory, recovery reason only on entering recovery) |
| `authority::advance_live_migration` | B2b-1/B2b-4: under `root_commit_mutex`, verify the binding successor, the durable manifest generation and that it is a valid manifest successor of the committed one, then commit a root carrying the new binding |
| `journal::capture_inventory` | Slice C1a: pure constructor of the manifest successor that captures a paged inventory (page set, entry count, `inventory_digest`) from sealed pages |
| `journal::seal_inventory_pages` / `inventory_page_dir` / `promote_inventory_set_fenced` | Slice C1b-1: seal each inventory page once, the directory its authenticated page-set digest names, and the fenced promotion of a whole captured page set into it |
| `authority::commit_inventory_capture` / `InventoryCapture` | Slice C1c: under `root_commit_mutex`, store the captured page set, publish the capture manifest and advance the binding as a capture, so the root only ever names a manifest whose pages are durable |
| `journal::assert_progress_successor` | Slice C1c: a valid successor that leaves the inventory fields alone; every checkpoint that is not a capture must satisfy it |
| `journal::verify_stored_inventory` / `load_inventory_page` / `VerifiedInventory` | Slice C1b-2: verify the stored page set the root binding names (page by page, one page in memory) and read one page back by its authenticated reference |
| `journal::assert_takeover_successor` / `assert_takeover_promote_authority` / `assert_binding_takeover` | Pure B2c predicates: a takeover is the committed owner's lease-expired successor with fence + 1 and revision + 1 that changes ownership only |
| `journal::publish_takeover_fenced` | B2c: takeover authority, the committed generation loaded bounded and authenticated, the takeover successor check, then the same publish-or-adopt step as the checkpoint |
| `authority::commit_journal_takeover` | B2c: under `root_commit_mutex`, read the committed binding, publish the new owner's claim (lease expired at the caller's `now`, fence + 1), advance the binding to the new fence and record it as the commit evidence |
| `authority::commit_journal_checkpoint` | B2b-2/B2b-3: under `root_commit_mutex`, read the committed binding, publish the owner's next manifest against it (R4; an identical candidate from a failed attempt is adopted), then advance the binding to that generation |
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

Boundary: a retry after the middle crash window met `GenerationExists` for the candidate; B2b-3
below adopts an identical candidate. Nothing calls the checkpoint yet.

Proof: seven cases in `gate4d_root_binding_test`: the checkpoint publishes and advances; no bound
migration; stale owner, another operation, the committed revision, a skipped revision and a fence
mismatch; a different key route or epoch; a failed root commit leaving the manifest as an unadopted
candidate; chained checkpoints and a repeated revision refused afterwards.

## B2b-3 — adopting an identical candidate on checkpoint retry

After the promote and before step F a failed root commit leaves revision `r + 1` as an unadopted
candidate (§10.1.1: discardable or retryable). `journal::publish_manifest_fenced` replaces the plain
promote inside `commit_journal_checkpoint`. Under the same fence, the same R4 authority check and
before any write, it reads the exact path of `generation-<r + 1>` (never the directory):

| Generation `r + 1` | Result |
|---|---|
| absent | promoted as before (`link_no_replace` still refuses a name created in between) |
| present, authenticates under the journal key, carries the key epoch a promote pins (1) and decodes to exactly the caller's manifest | adopted: no staging file, no journal byte written, the binding advances to the digest of the existing bytes |
| present, a different manifest (another lease, phase, cursor or fence) | refused as `GenerationExists` (`promoted = false`, no staging residue); nothing written or removed |
| present, not openable (garbage, another generation's bytes) or sealed under another key epoch | refused as `GenerationExists`; left untouched |
| present and larger than `MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES` (4096) | refused as `GenerationExists` without being loaded: the read stops at the bound |
| any other read failure | `Stage` I/O failure, nothing written |

Reading first (instead of attempting the promote and catching `GenerationExists`) matters: a failed
promote preserves its staging file for reconciliation, so a retry loop would otherwise leave
residue and could collide with its own staging name. The adopt path is therefore also free of
residue across repeated failed retries.

The read is bounded. `DurableFs::read_at_most(path, limit)` returns `None` for a larger file and
`StdFs` never allocates more than `limit + 1` bytes, so a crafted candidate cannot exhaust memory on
a retry. A valid manifest carries no inventory and its longest fields are two identifiers of at most
128 bytes, so a sealed manifest is well below the 4096-byte bound (a test seals the longest valid
manifest and checks it stays under half of it). The trait method defaults to `read` so wrappers and
test doubles keep working; an adapter that reads real files must override it.

Limit: a retry must pass the same manifest value. A manifest rebuilt with, for example, a new lease
expiry is a different candidate and is refused, because discarding it needs a relocation primitive
that is not part of this slice. The R4 authority check runs first, so a stale owner can never adopt
the committed owner's candidate.

Proof: seven cases in `gate4d_journal_durable_test` (absent → written, identical → adopted with zero
creates and an unchanged directory; a different, garbage, wrong-generation and other-key-epoch
candidate refused and unchanged; a stale owner or missing binding refused before any read, proven with a double that
panics on a read; an oversized candidate refused with only the bounded read allowed; a non-absence
read failure; `StdFs::read_at_most` at, over and under the limit; the longest valid manifest under
the bound) and
five new cases in `gate4d_root_binding_test` (the retry adopts and the directory is byte-identical,
repeated failed retries leave no residue and the next retry still adopts, a different candidate is
refused and the original is still adoptable afterwards, an unopenable candidate is refused and left
untouched, a stale owner cannot adopt).

## B2b-4 — the checkpoint publishes only a valid successor of the committed manifest

R4 proves who may publish which revision; it does not look at what is published. `publish_manifest_fenced`
now also loads the generation the committed binding names (exact path, bounded, authenticated
against the binding digest by `load_authoritative_manifest`) and refuses a manifest that is not its
valid successor, after the R4 check and before the candidate read, any adoption and any write. The
relation (`journal::assert_manifest_successor`) is enforced a second time where the root starts to
trust a generation: `advance_live_migration` loads both the committed manifest and the one the new
binding names and refuses a non-successor with `AuthorityError::LiveMigration`, so a manifest promoted
through the plain `promote_manifest_fenced` can never become authoritative. The relation mirrors what `transition_phase`,
`checkpoint_progress` and `mark_recovery` produce, plus the freezes §10.3 states:

| Rule | Refusal | Source |
|---|---|---|
| `journal_revision` is the predecessor's plus one | `StaleJournalRevision` (not above), `LiveBindingMismatch` (skipped or overflowing) | §10.1.1 |
| operation id kept / fencing generation kept | `LiveBindingMismatch` / `StaleMigrationOwner` | §10.1, §10.3 `CONVERT` ("current fencing generation") |
| operation type, source and target epoch, inventory version kept | `FrozenFieldChanged` | constructors clone them; epochs are immutable once a record is committed (§8.3) |
| phase unchanged, the next phase, or `RECOVERY_REQUIRED`; no successor of `DONE` or `RECOVERY_REQUIRED` | `InvalidPhaseTransition`, `TerminalPhase` | §10.3 ordering (`allows_phase_transition`) |
| cursor lies inside the successor's own inventory (an empty inventory takes only the empty cursor) | `Journal(EntryCountMismatch)`, `Journal(InvalidPageIndex)` | `checkpoint_progress` |
| cursor does not regress while the phase is unchanged | `RegressiveCheckpoint` | `checkpoint_progress` |
| target key reference (`has_target_root_key_ref`, digest) frozen once the successor is at `ADMIT` or later, so entering `ADMIT` keeps the key made durable in `PREPARE` | `FrozenFieldChanged` | §10.3 `PREPARE`: target key durable before admission |
| inventory fields (`inventory_digest`, `entry_count`, `page_count`, `journal_page_set_digest`) frozen once the successor is at `CONVERT` or later, so entering `CONVERT` keeps the inventory captured in `ADMIT` | `FrozenFieldChanged` | §10.3 `ADMIT`: the final inventory is captured in `ADMIT` |
| `recovery_reason_code` changes only when entering `RECOVERY_REQUIRED` | `FrozenFieldChanged` | `mark_recovery` |

Deliberately unconstrained, because no contract text or constructor fixes them: the lease fields
(the lease slice owns them) and the cursor across a phase change (`transition_phase` keeps it, the
contract does not say whether a new phase restarts it). The first production caller or the lease
slice tightens these. Revision `0` has no predecessor and is not checked.

The predecessor read is bounded. `load_authoritative_manifest` and `load_manifest_generation` now go
through `DurableFs::read_at_most` with `MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES`; a larger generation is
`Journal(Corrupt)`, never loaded.

Proof: eight pure cases in `gate4d_migration_state_test` (every constructor product is valid, the
revision table, the operation identity, the phase table including terminal phases, the cursor
regression rule, the cursor-inside-the-inventory rule, the target-key and inventory freeze table per
phase, the recovery reason and lease rules), four in
`gate4d_root_binding_test` (a phase jump and a changed epoch are refused with no journal write and
the root unchanged, an already-durable non-successor candidate is not adopted, a chain built only
through `transition_phase` is accepted through `DONE` and nothing follows `DONE`, and an advance to a
directly promoted non-successor is refused) and three in
`gate4d_journal_durable_test` (a non-successor candidate is not adopted, an oversized root-named
generation is corrupt for both loaders).

## B2c — owner takeover under the root lock

§10.1: "Lease expiry makes a new owner eligible but is not by itself permission for the old owner to
continue; a new owner must atomically advance the fencing generation", and §10.3 `ADMIT`: restart
claims the same journal "only after lease expiry and fencing CAS". R4 already refuses a stale owner;
this slice is the transition that creates the new one. It is a different transition from a
checkpoint by design: `assert_binding_successor` keeps the fence, a takeover must advance it.

`authority::commit_journal_takeover` runs under one `root_commit_mutex`, with the committed binding
read from the root:

| Rule | Refusal |
|---|---|
| the committed lease is expired at the caller's `now_unix_ms` (`now >= lease_expires_unix_ms`) or the committed manifest has no lease owner | `LeaseNotExpired` |
| the committed manifest is not terminal (`DONE`, `RECOVERY_REQUIRED`) | `TerminalPhase` |
| the claim carries the same operation, fence + 1 and revision + 1 | `LiveBindingMismatch` (other operation, skipped fence or revision), `StaleMigrationOwner` (not above the committed fence), `StaleJournalRevision` |
| the claim holds a lease with a non-empty owner id whose expiry lies after `now` | `InvalidTakeoverLease` |
| the claim is the committed manifest with only the revision, the fence and the lease replaced (phase, cursor, inventory, target key, recovery reason, operation identity unchanged) | `FrozenFieldChanged` |

The claim moves ownership only; the new owner makes progress through ordinary checkpoints under its
own fence. The committed manifest is loaded by exact path, bounded and authenticated against the
binding digest, and the relation is checked at publish (before any candidate read or write) and
again where the root starts to trust the generation, as for the checkpoint. A retry after a failed
root commit adopts its own identical claim with no journal write. The root binding advances to
`(operation, fence + 1, revision + 1, digest)` and the commit evidence records the new fence, so the
former owner's checkpoint is refused by R4 as a stale owner from then on.

Known liveness limit, resolved by B2d below: the claim's own lease is re-checked on a retry, so a
restart after the claim's lease expired builds a new claim, which differs from the durable candidate
and, under the default `Refuse` policy, is refused as `GenerationExists`.

The ordinary checkpoint does not consult the lease. An owner whose lease has expired but who has not
been superseded may still checkpoint under its fence: §10.1 makes "the lock/CAS ... the authority that
prevents an expired owner from resuming", not a clock, and lease expiry "is not by itself permission
for the old owner" only in the sense that a new owner may now supersede it. Self-fencing on a lease the
owner itself outlived is a lease-renewal policy for the slice that owns the lease fields.

The clock is an explicit input: Core never reads one, and a lease is expired when `now >=
lease_expires_unix_ms`. The caller supplies a trusted clock; a manipulated clock can claim early, which
is the same trust the lease already places in whoever writes its expiry. Nothing calls the takeover
yet. Cross-process exclusion of the root part is the root lock itself.

Proof: five pure cases in `gate4d_migration_state_test` (the lease boundary including `now ==
expires` and an unowned manifest, the fence and revision table, the new owner's lease, ownership-only
changes and terminal journals, the takeover authority table), three in `gate4d_journal_durable_test`
(publish then adopt with an unchanged directory, refusal before any write for an unexpired lease, the
same fence, a claim that also moves the phase and a forged committed digest, a different candidate
not adopted) and six in `gate4d_root_binding_test` (the binding and the evidence move to the new
fence, an unexpired lease refuses and the boundary admits, the former owner is refused and the new
owner continues, a retry after a failed root commit adopts the claim, refused claims write no
journal byte, no bound migration).

## B2d — moving a stale candidate aside

§10.1.1: revision `r + 1` "is a discardable or retryable candidate until the root itself advances", and
the retention rule covers only generations referenced by the previous committed root, the current
committed root or a prepared root. B2b-3 adopts an identical candidate and refuses every other one;
B2d lets the composed commits replace it. `journal::CandidateConflict` (default `Refuse`, the
behaviour so far) is a field of `JournalCheckpoint`, and so of `JournalTakeoverCommit`. With
`Quarantine`, after every authority, lease and successor check and before the publish, a candidate that is not identical to the manifest (a
different manifest, an unopenable file, an oversized file) is relocated with `commit::relocate` and the
manifest is promoted:

| Candidate at `generation-<r + 1>` | `Refuse` | `Quarantine` |
|---|---|---|
| absent | promoted | promoted |
| identical (authentic, same epoch, same manifest) | adopted | adopted, never discarded |
| a different manifest, unopenable, or larger than `MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES` | `GenerationExists`, untouched | moved to `generation-<r + 1>.rejected-<tag>`, then the manifest is promoted |

Relocation is the Gate 3 primitive used for the catalog pages of an uncommitted change
(`relocate_leftovers`): the bytes are linked to their rejected name and synced before the original name
is removed, so on a platform that confirms directory syncs a crash leaves them under one of the two
names. The relocation itself never reads the file; the publish reads it bounded beforehand to decide
whether it is the manifest. Preserving the bytes is a courtesy, not a requirement: §10.1.1 lets the
candidate be discarded outright, so where a directory sync cannot be confirmed (the `NotConfirmed`
result `relocate` does not act on) losing the rejected entry in a crash costs only diagnostic
evidence, never authority. The tag is a fresh random identity generated for each relocation, never the
caller's operation id, so two discards at one revision keep both candidates even when a caller reuses
an operation id, and `relocate`'s retry branch (which reads both files whole) is never reached.

Why this cannot orphan a root. A prepared root would have to name the candidate for the retention rule
to protect it, and none can: `load_committed_root` and `commit_root` refuse with `PreparationPending`
while the anchor holds a prepared root commit, and both composed commits read the committed binding
through `load_catalog` under the root lock before the publish, so reaching it proves that no preparation
is pending. An interrupted preparation is resolved by `recover_root` first, and a root completed
forward names the recovered revision, not the one below it. The policy is crate-private on
`JournalDurableContext`, so it cannot run without that proof. Authority, lease and successor checks
run before the candidate is looked at, so a refused manifest never discards anything.

Residual: a process that writes the journal with the low-level promote API without the root lock can
still race the relocation and the promote; that is the cross-process lease CAS, still open.

Proof: six cases in `gate4d_root_binding_test` (a retry with a different manifest replaces the candidate
and preserves its bytes while the default policy still refuses, a takeover claim after the first claim's
lease expired succeeds with a new claim, garbage and oversized candidates are preserved exactly, an
identical candidate is adopted and never discarded, a refused manifest never discards, two discards at
one revision keep both, a reused operation id still keeps every candidate).

## Slice C1a — capturing a paged inventory into the manifest

§10.3 freezes the inventory at `ADMIT` (`DISCOVER` records a preliminary one, `ADMIT` the final one) and
B2b-4's successor relation already lets the inventory fields change until then, but no constructor
produced them: `transition_phase`, `checkpoint_progress` and `mark_recovery` never touch them, and the
codec pieces (`JournalPage`, `page_ref_for`, `journal_page_set_digest`, `InventoryDigestVerifier`,
`verify_page_set`, `verify_inventory_pages`) stood unconnected. `journal::capture_inventory(manifest,
fence, pages)` is the manifest-side counterpart. It is pure: no I/O, no adapter, no layout decision.

| Input or state | Result |
|---|---|
| stale fence | `StaleMigrationOwner` |
| terminal journal (`DONE`, `RECOVERY_REQUIRED`) | `TerminalPhase` |
| `BOOTSTRAP_TARGET` (no inventory exists yet) or `PREPARE` (ordinary writes are admitted until `ADMIT`'s barrier, so a snapshot there would go stale; §10.3 captures the preliminary inventory in `DISCOVER` and the final one in `ADMIT`) | `InvalidPhaseTransition` |
| `CONVERT` or later, or a non-empty cursor in an open phase (conversion progress exists) | `FrozenFieldChanged` |
| pages not exactly indexed `0..n` (gap, duplicate, not starting at 0) | `Journal(PageSetMismatch)` (the pages may be supplied in any order) |
| a page generation above the new revision | `Journal(GenerationMismatch)` (generation 0 cannot even be built) |
| a page without entries | `Journal(InvalidDescriptorCount)`: an empty inventory is no page at all, so it keeps one canonical page-set digest |
| entries not strictly ascending across pages, or one entry on two pages | `Journal(NotStrictlyAscending)` |
| otherwise | the predecessor with `journal_revision + 1` and `page_count`, `entry_count`, `inventory_digest`, `journal_page_set_digest` replaced |

A page written for the capture carries the new revision as its generation; a page that did not change
keeps the earlier generation that still names it, so an `ADMIT` recapture rewrites only what changed.
The digests are computed with the same streaming verifier that later verifies the pages, the result is
re-checked with `verify_page_set` and accepted by `assert_manifest_successor`, and an empty inventory
captures the canonical empty digests. The page set binds the exact envelope bytes (`page_ref_for` takes
the `content_digest` of the sealed envelope), which a test shows by flipping one byte.

Not decided here, and the reason C1b is a separate slice: the manifest authenticates the page set only
as a digest, and the contract says the page set, not a directory listing, is authoritative, but it does
not say how the file of each page is found. C1b decides a physical layout and resolves pages by exact
path, with a listing used only as a hint that the authenticated digests then confirm or refuse.

Proof: twelve cases in `gate4d_capture_test` (empty inventory, flat-digest equivalence and verification
of one captured set, an unchanged page keeping an older generation, the digest binding the envelope
bytes, every phase and cursor refusal, a stale fence, the index and generation rules, cross-page
ordering, a recapture while no conversion has run).

## Slice C1b-1 — where the pages of a captured inventory live, and writing them

The manifest authenticates the page set only as `journal_page_set_digest`, and §10.1.1 says that digest,
not a directory listing, is authoritative, but nothing says how the file of each page is found.
Resolving "the highest generation not above the manifest's revision" by listing is unsound: a discarded
capture attempt (B2b-3 adopts, B2d moves aside) leaves pages the aggregate digest cannot tell apart.
Adding a field to the manifest would amend the normative field list, which is a maintainer decision.
So the physical directory is keyed by the authenticated digest itself:

```text
<journal-dir>/inventory/<hex(journal_page_set_digest)>/page-<index>/generation-<g>.wsr1
```

Pages of another attempt live under another digest; a single-file directory listing, when the reader
needs one, is only a hint that the same digest then confirms or refuses; and no identity moves into a
path (§3: the directory is a locator).

The caller seals every page once with `seal_inventory_pages` (identity `migration-page:<op>:<index>`,
generation bound in the envelope), because the set digest binds the exact envelope bytes and sealing
uses a fresh nonce each time. `capture_inventory` (C1a) then yields the manifest successor and its
digest `D`, and `promote_inventory_set_fenced` writes the whole captured set into `inventory/<D>/`
through the existing immutable stage-and-promote. It takes the set, not single pages, because the
directory is keyed by `D`: a page may only be written under the digest that the manifest successor
authenticates, so the writer proves the set against that successor before it creates anything.

| Condition | Result |
|---|---|
| fence token is not the manifest's | `Fence(StaleMigrationOwner)` |
| the committed binding is another operation, a later fence or another revision, or absent (an absent binding is always refused: only a root-named manifest is authority) | `Authority(...)` per R4's page rule |
| the committed manifest the caller supplied is not the generation the root binding names (the binding carries only operation, fence, revision and the envelope digest, so another manifest at the same revision would pass the capture checks against a predecessor that does not exist): the root-named generation is read back (bounded, `load_authoritative_manifest`, which verifies the binding digest) and compared | `Authority(LiveBindingMismatch)`, or the loader's own refusal (`RecoveryRequired` for an absent generation) |
| `successor` is not a valid successor of the committed manifest | `Authority(InvalidPhaseTransition)` and the like, via `assert_manifest_successor` |
| `successor` is not what `capture_inventory` builds from the committed manifest: a `BOOTSTRAP_TARGET` manifest, `CONVERT` or later, an advanced cursor, a simultaneous phase change, or any field other than the revision and the four inventory fields changed (the generic successor relation alone would accept these) | `Authority(InvalidPhaseTransition)` or `Authority(FrozenFieldChanged)` |
| `successor` does not encode (for example an entry count above the manifest bound) | `Journal(TooManyEntries)` and the like, so a set is never stored for a manifest that can never be sealed |
| the pages are not indexed exactly `0..n` (neither digest pins the indexes, so a hand-built successor could otherwise verify) | `Journal(PageSetMismatch)`, the same check `capture_inventory` makes |
| a page holds no entry (an empty inventory is no page at all; an empty page would give it a second page-set digest) | `Journal(InvalidDescriptorCount)`, the same rule `capture_inventory` applies |
| a page generation other than the successor's revision (`committed revision + 1`): the store writes only the pages of this capture. `capture_inventory` still lets an unchanged page keep the earlier generation that names it, but proving that the predecessor's page set contains those bytes needs the predecessor's authenticated page references, which only a verified reader of the stored set (C1b-2) can provide; an exact-path byte comparison is not membership, because an orphan envelope can sit in the predecessor's directory. An older generation is therefore refused until then | `Journal(GenerationMismatch)` |
| an envelope sealed for a key epoch other than the journal's pinned epoch (`JournalPage::open` does not compare the header epoch; the store checks it against the page metadata before writing, and staging validation repeats that check after creating the staging file) | `Stage(StagedEnvelopeMismatch)` with `promoted: false` and no residue |
| an envelope that does not open as the page it is stored for (swapped, other identity or generation) | `Journal(Open(..))` from `JournalPage::open`, or `Journal(InconsistentInventory)` when the opened page differs from the page handed over |
| the pages are not the set the successor names (envelopes of another capture, a missing or extra page, wrong entries) | `Journal(PageSetMismatch)` (page count or page-set digest), `EntryCountMismatch`, or `InconsistentInventory` (inventory digest) |
| a page whose exact bytes are already on disk (an earlier attempt at the same set) | adopted without staging; its directory chain is synced again |
| a different file already at that page generation | `GenerationExists`, the bytes already there untouched |

Every check above the last two runs inside `with_fence` before the first byte is written, so a store
refused by them creates nothing: no file, no directory. After that the pages are written one by one,
and an I/O failure partway leaves a durable prefix of pages. That prefix is not a dead end: a retry
of the same set adopts each identical page that is already on disk (a bounded read of the exact path,
compared with the envelope, no new staging file), syncs its directory chain again because the
earlier attempt may have stopped before its directories were durable, and continues with the first
missing page. The set is verified with the same streaming verifier the reader will use
(`InventoryDigestVerifier` for the entries and `successor.verify_page_set` for the page-set digest
over the exact envelope bytes).

Pages are candidates until a manifest naming `D` is committed (§10.1.1: "a new page generation is
durable but the manifest still names the old generation ... a discardable or retryable candidate"), so
they are written before that manifest. After each page the directory chain up to the journal
directory is synced (page directory, set directory, `inventory`, journal directory), so a page cannot
vanish after the manifest that names it is durable. A failure of one of those syncs is reported as
`StageFailure { step: SyncDirectory, kind: Io, promoted: true }` with the staging residue of the
promotion: the page is already visible, and a retry adopts it instead of meeting an absent page.
When a retry adopts a page under the same operation id, the store probes this operation's own
staging path before reporting, so a staging link an earlier attempt could not remove is never
reported as absent (an uninspectable path counts as present). A
crash between the pages and the manifest leaves an inert directory under an unreferenced digest,
reclaimable by the retention rule once no root can name it.

Memory: the whole set is held in memory while it is verified, which bounds this slice to inventories
that fit. That is recorded as an acceptance criterion on #359 (a streaming capture that seals, digests
and promotes one page at a time must precede very large inventories), not decided here.

Proof: fifteen tests in `gate4d_inventory_store_test`, three of them tables that assert the exact
error and that nothing was created for each case: a stored set whose bytes verify against the
captured page set, the directory chain synced, a post-promotion sync failure reported as promoted;
the authority refusals (later fence, another operation, a digest naming another manifest, no
binding); a predecessor that is not the root-named manifest; successors the store cannot accept
(phase skipped, bootstrap manifest, advanced cursor, simultaneous phase change, unencodable
counters); page sets the successor does not name (envelopes of another capture, indexes not `0..n`,
an empty page, a generation above the next revision); a swapped envelope and a foreign key epoch;
a page keeping an older generation refused even when a genuinely stored predecessor holds it; page
sets with different digests never colliding;
the same set stored again adopting its identical pages, and an adopted page still reporting the
staging link an earlier same-operation attempt left behind; a set that failed partway completed by a retry that stages only the missing page; a different
file at a page generation never replaced; sealed pages binding identity and generation.

## Slice C1b-2 — reading a stored page set back

The store writes pages under `inventory/<D>/page-<index>/generation-<g>.wsr1`; §10.1.1 says a file
name or listing is never authoritative for page identity, generation or membership, that a missing
page is `RECOVERY_REQUIRED`, that mixed generations or an unverifiable digest are
`RECOVERY_REQUIRED` and never guessed from file names, and that the inventory must not be loaded
into memory whole. The page generation is bound inside the page-set digest but not stored in the
manifest, so it can be confirmed, not read.

`verify_stored_inventory(ctx, live)` is pass one:

| Step | Rule |
|---|---|
| manifest | loaded by the reader itself through `load_authoritative_manifest` (root-named generation, digest-verified); never a caller-supplied manifest |
| generation | the listing of `inventory/<D>/page-<i>/` is a hint, bounded while it is read (`DurableFs::list_dir_at_most`, at most 64 entries; `StdFs` never collects more than 65 names): exactly one canonical `generation-<n>.wsr1` (staging leftovers and other names ignored); none, several, a directory with more than 64 entries or a missing directory is `Authority(RecoveryRequired)` |
| read | bounded by the largest valid sealed page (`MAX_JOURNAL_PAGE_BYTES` + envelope header + tag); a larger file is `Journal(Corrupt)` before any parse; a missing file is `Authority(RecoveryRequired)` |
| open | `migration-page:<op>:<i>` at that generation under the journal key, at the pinned key epoch (`Journal(Open(..))`, `GenerationMismatch`, `WrongPageIndex`, `Corrupt` for another epoch) |
| canonical | a page generation outside `1..=journal_revision` (`GenerationMismatch`) or a page without entries (`InvalidDescriptorCount`) is refused even when both digests confirm it: `capture_inventory` states these rules, so a set that breaks them was written by something else and is not certified |
| digests | the inventory digest is streamed one page at a time; only the 48-byte page reference is kept per page; at the end `verify_page_set` and the inventory digest confirm what the listing hinted (`PageSetMismatch`, `EntryCountMismatch`, `InconsistentInventory`) |

`load_inventory_page(ctx, &verified, index)` is pass two: it reads the exact path of the verified
reference (no listing), requires `content_digest(bytes)` to equal the reference before opening, and
checks the entry count, so a file that changed after pass one is refused (`PageSetMismatch`).
`VerifiedInventory` has private fields: only pass one constructs it, and its page references are the
authenticated references the store needs to inherit unchanged pages later (acceptance criterion on
#359). The reader creates nothing, takes no lock and mutates nothing; generations are immutable. It
returns typed refusals and leaves the mapping to the `RECOVERY_REQUIRED` state to the first semantic
caller (Gate 4E/5).

Proof: fourteen tests in `gate4d_inventory_read_test` over a really stored set: set verifies and every
page loads back equal with no file created, an empty inventory, an index outside the set, a table of
damaged storage (missing file, missing directory, only a staging leftover, a second canonical
generation, an over-full directory), the bounded listing stopping at its limit, a staging leftover beside the generation ignored, a tampered
page and a page of another index, an authentic page the manifest does not name, a page set a canonical writer cannot produce (a generation above the revision, an empty page) not certified, a foreign key epoch,
an oversized file, another digest's directory never read, a page that changed after verification
refused on load, a binding that does not name the stored manifest. The fixtures are shared with the
store tests (`tests/support/inventory.rs`).

## Slice C1c — the composed capture commit

After C1a (the capture constructor), C1b-1 (the page store) and C1b-2 (the reader), the capture is
three separate steps. §10.1.1 makes pages candidates until a manifest naming them is durable, and a
new manifest revision a candidate until the root advances, so the composition has an order: pages,
then the manifest, then the binding. `commit_inventory_capture` runs it under one `root_commit_mutex`
(lock order: root lock, then the journal mutex inside each fenced step):

| Step | Rule |
|---|---|
| token | the caller's fence must be the successor's own token (`assert_fence`), checked before anything is written, so pages are never stored under a token the publish would then refuse |
| binding | the committed binding is read from the root (a missing binding, another key route or epoch is refused, nothing written) |
| pages | `promote_inventory_set_fenced` under the committed manifest and the caller's fencing generation: every check before the first write, directory chain synced, identical pages adopted on a retry |
| manifest | `publish_manifest_fenced` as for a checkpoint, with the publish marked as the capture: the only publish that may change the inventory fields, and only as the capture-window successor; an identical candidate is adopted |
| binding | the root advances as `BindingStep::Capture`, accepted only as the CAS successor whose manifest is the capture-window successor; the durability of the page directories counts toward `RootCommitted.directories`, so an adapter that cannot confirm them never yields `Confirmed` |

**Crash windows.** A crash after the pages leaves an inert directory under an unreferenced digest;
after the manifest, revision `r + 1` as an unadopted candidate while the root still names `r`. The
same call retried adopts what is durable, writes only what is missing and advances the binding
(tests: a failed root commit retried writes no byte at all; a failure creating the manifest
retried completes, with the pages already durable and the manifest and root untouched).

**Who may change the inventory.** The inventory fields (page count, entry count, `inventory_digest`,
`journal_page_set_digest`) were frozen only from `CONVERT`, so before that a plain checkpoint or
`advance_live_migration` accepted any generic successor and the root could be advanced to a manifest
naming a page set nobody wrote. Now `BindingStep::Checkpoint` (progress and `advance_live_migration`)
requires `assert_progress_successor` (the inventory kept, else `FrozenFieldChanged`) and
`commit_journal_checkpoint` refuses an inventory-changing manifest through the same check in the
publish, before a journal byte is written; only `BindingStep::Capture` accepts a change, and only as
`assert_capture_successor`, which is the generic successor relation (`prev + 1` and the rest) plus the capture window, so the exported predicate cannot accept a non-successor. Error classes of the existing checkpoint refusals are unchanged: the
generic successor relation runs first.

Proof: nine tests added to `gate4d_root_binding_test` and one to `gate4d_capture_test` (a capture stores the pages, publishes the
manifest and advances the binding and the reader verifies the result; no bound migration; refusals
before the store write no page and no manifest: the pages of another capture and a stale owner; a
failed root commit retried adopts pages and manifest and writes nothing; a failure between the pages
and the manifest retried completes; a progress checkpoint cannot change the inventory, neither
through the checkpoint commit nor through `advance_live_migration`; a capture cannot change the key
route; a token that is not the successor's writes no page; unconfirmed page directories keep the
commit from reporting `Confirmed`; the exported capture predicate rejects a skipped or repeated
revision).

## Still residual after C1c

- Binding transitions other than the advance and the takeover: bind (bootstrap) and clear
  (terminal), which belong to the Gate 4E/5 enable and commit sequences.
- R2B remainder: recovery when the root-named envelope exists but semantic open refuses.
- Bounded generation reads elsewhere: the journal manifest reads are bounded
  (`DurableFs::read_at_most`) and the page-directory listing is bounded (`DurableFs::list_dir_at_most`; both defaults must be overridden by an adapter over real files, which `StdFs` does), but the Gate 3 post-promotion verify and the page, marker and root
  reads still use the whole-file `DurableFs::read`. Applying the same size limits to them is a
  separate slice, recorded as an acceptance criterion on #359.
- Successor rules still open: the lease fields and the cursor across a phase change (see B2b-4).
- Conversion (C2+) over the verified page set. Its admission must also require that the inventory was captured under `ADMIT` before `CONVERT` is entered (the manifest has no field that says so; acceptance criterion on #359).
- Write barrier of the final capture: `commit_inventory_capture` takes no admission guard; the barrier is the durable `ADMIT` phase the orchestrator establishes by draining writers, and the write path must refuse ordinary mutating writes by that phase (`ordinary_mutating_writes_admitted`) before the final capture has a caller (Gate 4E/5; acceptance criterion on #359).
- Inheriting unchanged pages: the C1b-2 reader now returns the authenticated page references, so the store may accept a page that keeps an earlier generation if those references name exactly its bytes (acceptance criterion on #359, a follow-up slice). Until then every page of a capture is rewritten at the new revision.
- Streaming capture: `promote_inventory_set_fenced` verifies the set in memory; a one-page-at-a-time seal, digest and promote is needed before very large inventories (acceptance criterion on #359).
- The cross-process lease CAS.
- Root-bound `key_epoch` alignment: §8.3 fixes first-time enable at epoch 1 (the current constant),
  but the contract does not say which epoch seals the journal during rotation, so that needs a
  contract decision with the rotation slice.
- Mixed-key conversion, Gate 4E/5/6/7, production authority switch.

## Explicit non-goals (journal durable promotion)

- Root `LiveMigration` binding bootstrap and clear (the advance is covered by B2b-1 above).
- Adopting a manifest generation ahead of the root on resume (B2a); the checkpoint retry adopts only
  an identical candidate of the committed owner's next revision (B2b-3).
- Cross-process lease CAS.
- Mixed-key inventory conversion (Slice C+).
- TypeScript/Tauri wiring, production authority switch, Gate 4E/5/6.

## Tests

Integration: `crates/worldscript-secure-storage/tests/gate4d_journal_durable_test.rs` (4 promotion cases, 7 root-bound resume cases, 9 R4 caller-authority cases, 7 B2b-3 publish and bounded-read cases, 3 B2b-4 cases and 3 B2c takeover cases).
Integration: `crates/worldscript-secure-storage/tests/gate4d_root_binding_test.rs` (9 B2b-1 binding-advance cases, 6 B2b-2 checkpoint cases, 5 B2b-3 candidate-retry cases, 4 B2b-4 successor cases and 6 B2c takeover cases and 7 B2d discard cases).
Unit: `crates/worldscript-secure-storage/tests/gate4d_migration_state_test.rs` (8 B2b-4 successor-relation cases and 5 B2c takeover cases beside the earlier state-machine cases).

Unit (mutex): `journal_durable_mutex_blocks_try_lock_while_guard_held` and
`with_fence_holds_mutex_during_closure` in `journal::durable::mutex_proof`.

Gate 4D overall status: **IN PROGRESS**. B2a resume selection, R4 promote-time caller authority,
the B2b-1 root binding advance, the B2b-2 journal checkpoint, the B2b-3 candidate adoption on
retry, the B2b-4 successor-relation guard, the B2c owner takeover and the B2d discard of a stale
candidate are in scope above; B2 is not terminal.
