# Gate 4B — read/snapshot admission candidate

Predecessor: `3cd2b6a37ab8b5bbe8abe32830cd8170b0c9d052` (#951 foundation).
Extraction source: frozen #952 `e34aae28bba31269a814a9a2778346e568c3577e`.
This independently compiled slice supersedes only #952's read/snapshot half.
#360 remains open; Gate 4B and Gate 4 are not terminal.
`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Boundary and lifetime

`ProtectedStorage` owns its provider privately. A nonordinary record is refused before provider
observation. Ordinary reads acquire shared kernel admission, validate scope, then capture the
authenticated root handle and key under the authority-cell mutex. The Arc pin is established
inside that same mutex, never as a later read-then-increment. Local publication uses that mutex;
the deterministic capture-to-pin test exercises the exact paused-reader window.

Each snapshot authenticates its exact root and immutable key-epoch control generations. Subsequent
reads re-open and authenticate those retained entries; later directory heads are not historical
authority. Missing/tampered entries refuse, while transient I/O retains its typed error. Current
cold-start verification still authenticates the complete current key-epoch set.

The read validates record/marker directory identity before catalog absence can be reported, then
authenticates only the catalog-named generation. Locked, unconfigured, migrating and exclusive
transition states never become legacy plaintext access. Admission, key and snapshot stay live
through the caller's handoff callback. Field order drops key/pin before shared admission.

An externally committed ordinary same-key root advance can rebind the coordinator's private
runtime only while shared admission is held and only after a validated anchor proves the same scope,
strictly forward generation and exact root-key route. The provider's live unlock-session binding
supplies the baseline even before first capture; explicit lock clears that non-authorizing witness.
The post-unlock and post-key-resolution committed read-authority projections must be unchanged;
both full anchors are validated, but prepared recovery intent is not committed read authority.
explicit lock, rotation, rollback, missing, malformed and ambiguous authority remain refused.
Catalog enumeration follows the same admitted snapshot path; raw catalog enumeration is test-support
only and is not a production public API.

`AuthoritySnapshotGuard` is Send, not Sync or Clone. `SnapshotRetention` is a Weak local reference
observation, not scope/deletion authorization. The current cell may itself keep that reference.
Physical reclamation still requires exclusive admission and every durable/recovery condition.

## Headless proof

- `gate4b_read_snapshot_test`: simultaneous shared readers; handoff exclusion; second-process
  transition/read refusal before provider observation; Send assertion; replacement refusal;
  missing versus transient retained-epoch I/O; reserved/foreign absent locators; nonordinary
  zero-observation refusal; locked/unconfigured/migrating plaintext preservation.
- `operation_authority` unit test: forced capture-to-pin pause, competing publication blocked by
  the same mutex, old handle survives publication, owning pin release updates Weak observation,
  and a second runtime adopts only an external same-key forward root advance.
- `gate4b_read_snapshot_test`: admitted enumeration returns catalogued identities and refuses
  exclusive/locked/unconfigured/migrating access before catalog/key work.
- `root_store` unit test: old root remains valid after later registry/root publication using its
  retained authenticated epoch evidence; latest-set substitution, tamper and missing bytes refuse.
- Compile-fail doctests prohibit sharing/cloning one snapshot guard.

The existing Linux Core Rust gate runs these tests; macOS/Windows platform evidence names this
integration suite explicitly. Source CI is not packaged or physical power-loss evidence.
Fixtures preconfigure/seed through Gate 3 test vectors before transferring provider ownership;
they do not claim normal mutation or Gate 4E first-enable admission.

## Deferred, still material

Mutation/root-recovery/lifecycle is the successor owner under #360. Frozen #952's valid prepared-
root recovery finding remains unresolved: the future provider-owning mutation coordinator must
invoke existing authenticated `recover_root` under admission/writer serialization and a finite
root event before fresh capture. No normal write, reconciliation, pending latch, lifecycle,
collector, journal, rekey, migration or current renderer authority is enabled here.
