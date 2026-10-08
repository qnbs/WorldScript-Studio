# Gate 4D slice B — live gap matrix (post–PR #957)

Owner: QNB-11 / #359. Predecessor: Slice A execution state on `main` @ `8f1400c4…` (PR #957).

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.

## Slice A closed scope (do not re-open in B)

In-memory §10.3 helpers in `journal/state.rs`: fence token checks, live binding to root
`LiveMigration`, authoritative revision selection, phase transitions with revision bumps,
checkpoint cursor bounds, terminal `RECOVERY_REQUIRED` / `DONE`, `PREPARE` write admission.

## Residual matrix (Slice B first)

| Gap | Contract anchor | Current `main` | Slice B intent |
|-----|-----------------|----------------|----------------|
| Durable journal manifest generations | §10.1.1 immutable republish per `journal_revision` | Seal/open in memory only (`gate4c_journal_test`) | Stage/promote sealed manifest bytes via `durable` (3A), generation-addressed under `migration:<op>` |
| Durable journal pages | §10.1.1 `migration-page:<op>:<idx>` | Codec only | Same 3A pattern per page generation |
| `with_fence` boundary | §10.1 preface | `MigrationFence` in-process only | Adapter holds fence through mutation + sync; refuse stale token before I/O |
| Root `LiveMigration` binding update | §5.4 / §10.1.1 retention | Root types exist; no journal publish hook | The advance `r → r+1` is implemented as `advance_live_migration` (B2b-1): CAS against the root read under `root_commit_mutex`, durable manifest verified, no journal write. The promote-plus-advance coordinator is `commit_journal_checkpoint` (B2b-2), which adopts an identical candidate on retry (B2b-3). Owner takeover is `commit_journal_takeover` (B2c). Bind (bootstrap) and clear stay open |
| Cross-process lease CAS | §10.1 lease fields on manifest | Wire validation only | Out of minimal B unless required for single-process durable proof |
| Inventory execution / mixed-key conversion | §10.2+ | Deferred 4D slices C+ | Not B |

## Smallest safe first PR (recommended)

Journal revision and `RecordMeta.record_generation` stay aligned per `JournalManifest::seal`, but
**normal** `DurableFs::stage_and_promote` always seals through `seal_record`, which rejects
generation `0`. Bootstrap revision `0` is already sealed via `JournalManifest::seal` →
`seal_journal_manifest_bootstrap` on `main` (`journal/manifest.rs`); Slice B must not pretend
`stage_and_promote` alone publishes revision `0`.

1. Headless `journal/durable.rs` (name TBD): durable promotion keyed by `RecordIdentity` +
   generation = `journal_revision`, with tests on tempdir + `StdFs`.
   - **`journal_revision > 0`:** seal with `JournalManifest::seal` (or equivalent) then promote
     the envelope with `DurableFs` (or extend promotion to accept a pre-sealed envelope without
     re-entering `seal_record` for generation `0`).
   - **`journal_revision == 0`:** use the existing bootstrap sealing path only; specify how the
     sealed bootstrap envelope is promoted durably without calling `stage_and_promote`'s
     `seal_record` entrypoint.
2. In-process `with_fence` wrapper that pairs `MigrationFence` with a mutex (single-process
   stand-in for cross-process lock until platform adapter exists).
3. Evidence doc `GATE4D-JOURNAL-DURABLE-EVIDENCE.md` + focused integration test; no TS/Tauri wiring.

**Not in Slice B PR 1:** advancing root `LiveMigration` in the same fenced sequence as manifest
durability. A crash after manifest sync and before root update can leave a newer durable manifest
than `LiveMigration` names; `assert_live_binding` rejects that mismatch until reconciliation exists
(`authoritative_manifest_revision` selects the root revision but no durable caller proves restart
load of the newer generation yet).

## Explicit non-goals for Slice B PR 1

- Production authority switch
- Gate 4E enable/disable refusal
- Gate 5 exhaustive writers
- Crash-injection / Gate 6 packaging
- QNB-192 CodeScene local preflight tooling

## B1 hardening acceptance (closed on B1 PR; B2 still owns durable authority)

| Residual | B1 outcome | B2 if still open |
|----------|------------|------------------|
| Public unfenced promote entrypoints | Crate-private primitives; fenced public API | — |
| Post-promotion read I/O failure | `StageFailure.promoted == true` + promotion `staging` residue | — |
| Post-promotion semantic open/verify failure | Documented: `JournalDurableError::Journal` without promoted provenance | Recovery when durable generation exists but open refuses; `GenerationExists` on naive retry |
| Mutex proof | `try_lock`/`WouldBlock` under guard and inside `with_fence` closure (unit tests) | Cross-process CAS when required |
| Stale manifest + matching fence | Not in B1 scope | R4 closed it against the caller-supplied committed binding (single-process, before I/O); a stale copy of that binding and the cross-process CAS stay open |
| `key_epoch: 1` in journal meta | Resolved by Slice D2a: no constant; `journal_envelope_epoch` derives the epoch from the authenticated manifest (§10.1.1) | Registry resolution of the journal key and retention of a bound source epoch (Slice D2b) |

## Successor slices (not B)

- Slice B2a: a durable manifest ahead of the root resumes the root-named generation and does not adopt the newer file. Root `LiveMigration` advancement and R2B stay separate.
- Slice R4: a promote whose caller is not the committed binding's owner and revision is refused before I/O. It adds no root read or write.
- Slice B2b-1: the root's live-migration binding advances to the journal owner's next revision only as the CAS successor of the binding read under the root lock, naming a durable, authenticated manifest generation. It writes no journal byte.
- Slice B2b-2: the journal owner's checkpoint publishes the next manifest revision against the binding read from the root and advances the binding to it, under one root lock. Bind, clear and owner takeover stay separate.
- Slice B2b-3: a checkpoint retry adopts an identical existing candidate of the owner's next revision (exact-path bounded read, no write, no staging residue) and refuses a different or unopenable one untouched. Discarding such a candidate (R2B remainder) stays separate.
- Slice B2b-4: the checkpoint publishes only a valid successor of the manifest the root names: revision + 1, kept operation identity, allowed phase step, cursor inside the inventory and not regressed within a phase, target key frozen from `ADMIT` on, inventory frozen from `CONVERT` on, both judged by the successor's phase, recovery reason only on entering recovery; enforced at publish and again at the root binding advance. Lease fields and the cursor across a phase change stay unconstrained until their slices. The journal manifest loads are bounded.
- Slice B2c: a new owner takes over the journal under the root lock: the committed lease is expired at the caller's clock (or absent), the claim carries fence + 1 and revision + 1 and changes ownership only, the root binding advances to the new fence and the commit evidence records it; the former owner is refused afterwards by R4. Progress by the new owner is an ordinary checkpoint.
- Slice B2d: the composed commits can move a durable next-revision candidate that differs from their manifest (different, unopenable or oversized) aside with its bytes preserved (`commit::relocate`) and publish their own; the default policy still refuses, an identical candidate is still adopted, and a refused manifest never discards. Safe because reaching the publish proves no prepared root names the candidate. Semantic-open recovery of the root-named envelope stays open.
- Slice C1a: a pure constructor captures a paged inventory into the manifest (page set, entry count, inventory digest) from sealed pages while the inventory is open (before `CONVERT`, no conversion progress); page layout, promotion and reading follow in C1b.
- Slice C1b-1: the pages of a captured inventory live under a directory keyed by the authenticated page-set digest (`inventory/<hex digest>/page-<index>/`), are sealed once by the caller and the whole captured set is promoted fenced for the committed owner before the manifest that names them (the set is proven against the successor first, so nothing is created for a refused store); the directory chain is synced and a failed sync is reported as already promoted. The composed commit under the root lock (C1c) follows.
- Slice C1b-2: a verified reader of a stored page set: it loads the root-named manifest itself, resolves each page's generation from its digest-keyed directory only as a hint (none, several or a missing one is `RecoveryRequired`), reads bounded, opens each page at its identity and operation's journal envelope epoch, streams the inventory digest one page at a time, keeps only the page references and confirms the page-set and inventory digests; one page is then read back by its authenticated reference. Read-only, no lock; the semantic-open mapping to `RECOVERY_REQUIRED` stays with the first caller (Gate 4E/5).
- Slice C1c: the composed capture commit under the root lock stores the page set, publishes the capture manifest and advances the binding as a capture; the root now accepts a change of the inventory fields only through a capture and requires every other checkpoint to leave them alone.
- Slice D1: the manifest carries an authenticated `final_inventory_captured` flag; only the capture inside `ADMIT` sets it, and `ADMIT → CONVERT` is refused without it.
- Slice D2a: the journal envelope epoch is derived from the authenticated manifest (`ENABLE`, exactly the first-time `0 → 1` of §8.3, seals under the target epoch, `ROTATE` and `ENVELOPE_MIGRATION` under the source epoch) instead of a constant; a manifest or page sealed under another epoch is refused (`KeyEpochMismatch`) before a byte is written or accepted. Registry resolution of the journal key and the refusal to revoke a bound source epoch are Slice D2b.
- Slice D2b-1: the key-epoch writer refuses a `Revoked` generation while the committed root binds a live migration (every new revocation, since the binding does not name the journal's epoch), so the bound journal's source epoch stays resolvable until the binding is cleared; the registry-resolved journal key route and the manifest pre-key epoch comparison are D2b-2 and D2b-3.
- Slice D2b-2: a manifest's header epoch is compared with trusted authority before the key is used (`ManifestRead`; the epoch of the authenticated predecessor for readback, adoption and generation loads, the root-vouched header for the root-named manifest, whose digest is judged before the open), so another epoch's manifest is `KeyEpochMismatch` rather than an open failure; the registry-resolved journal key route is D2b-3.
- Slice D2b-3a: `resolve_journal_key` resolves the key of a bound journal through authority read from the committed root itself: the registry the root commits to (its `key_epoch_set_digest` verified, so a removed or uncommitted generation is refused), the root's own binding naming the journal, the root-named manifest judged against its digest, the header epoch it vouches for looked up in the registry (`Prepared`, `Active`, `RetiredRecoveryOnly` usable, `Revoked` or absent fail closed) and the record's route resolved; never the root's active epoch, so it survives cutover. Read-only and additive; the composed operations still take a caller key until D2b-3b.
- Slice D2b-3b: the four journal-owner operations (checkpoint, takeover, inventory capture, binding advance) resolve the journal key through `resolve_journal_key` under the root lock before any journal write; `JournalSource` no longer carries a key, so it is not a caller input. An unroutable epoch (`Revoked`, unregistered) refuses all four before a write, and a route to a key the journal was not sealed under is refused by the authenticated load. All D2b criteria are closed.
- Epoch relation: `journal_envelope_epoch` refuses a `ROTATE` whose target is not above its source (§8.3 item 2) and an `ENVELOPE_MIGRATION` whose target differs from its source (§10.4, stated by this slice: it keeps the key epoch, a newer epoch is a rotation), so such a manifest neither encodes nor decodes; closes the pre-caller validation criterion before any caller writes a rotation journal.
- Slice D3a: the successor relation constrains the cursor and the lease across manifests (maintainer decision C): a forward phase change enters the new phase at `(0, 0)` (`CursorNotReset`), entering `RECOVERY_REQUIRED` keeps the last cursor, and an ordinary successor leaves the lease alone, so the owner and the fence change only by takeover; `assert_renewal_successor` is the predicate of the same-owner renewal (expiry strictly forward), wired in D3b.
- Slice C: record conversion / mixed-key inventory execution as live truth requires
- Gate 4E: first enable/disable closure
- Root two-phase commit coupling with step F when journal + root must advance together (after B2)
