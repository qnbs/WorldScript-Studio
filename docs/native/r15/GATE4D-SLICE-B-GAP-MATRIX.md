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
| `key_epoch: 1` in journal meta | B1 convention unchanged; not normatively proven as final epoch | Root-bound epoch + binding before root advance |

## Successor slices (not B)

- Slice B2a: a durable manifest ahead of the root resumes the root-named generation and does not adopt the newer file. Root `LiveMigration` advancement and R2B stay separate.
- Slice R4: a promote whose caller is not the committed binding's owner and revision is refused before I/O. It adds no root read or write.
- Slice B2b-1: the root's live-migration binding advances to the journal owner's next revision only as the CAS successor of the binding read under the root lock, naming a durable, authenticated manifest generation. It writes no journal byte.
- Slice B2b-2: the journal owner's checkpoint publishes the next manifest revision against the binding read from the root and advances the binding to it, under one root lock. Bind, clear and owner takeover stay separate.
- Slice B2b-3: a checkpoint retry adopts an identical existing candidate of the owner's next revision (exact-path bounded read, no write, no staging residue) and refuses a different or unopenable one untouched. Discarding such a candidate (R2B remainder) stays separate.
- Slice B2b-4: the checkpoint publishes only a valid successor of the manifest the root names: revision + 1, kept operation identity, allowed phase step, cursor inside the inventory and not regressed within a phase, target key frozen from `ADMIT` on, inventory frozen from `CONVERT` on, both judged by the successor's phase, recovery reason only on entering recovery; enforced at publish and again at the root binding advance. Lease fields and the cursor across a phase change stay unconstrained until their slices. The journal manifest loads are bounded.
- Slice B2c: a new owner takes over the journal under the root lock: the committed lease is expired at the caller's clock (or absent), the claim carries fence + 1 and revision + 1 and changes ownership only, the root binding advances to the new fence and the commit evidence records it; the former owner is refused afterwards by R4. Progress by the new owner is an ordinary checkpoint.
- Slice C: record conversion / mixed-key inventory execution as live truth requires
- Gate 4E: first enable/disable closure
- Root two-phase commit coupling with step F when journal + root must advance together (after B2)
