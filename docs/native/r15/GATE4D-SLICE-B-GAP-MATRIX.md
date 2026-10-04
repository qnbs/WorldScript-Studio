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
| Root `LiveMigration` binding update | §5.4 / §10.1.1 retention | Root types exist; no journal publish hook | After manifest durability, advance root live binding in same fenced sequence (bounded subset in B) |
| Cross-process lease CAS | §10.1 lease fields on manifest | Wire validation only | Out of minimal B unless required for single-process durable proof |
| Inventory execution / mixed-key conversion | §10.2+ | Deferred 4D slices C+ | Not B |

## Smallest safe first PR (recommended)

1. Headless `journal/durable.rs` (name TBD): publish one manifest revision using existing
   `DurableFs::stage_and_promote`, keyed by `RecordIdentity` + `RecordMeta` generation =
   `journal_revision`, with tests on tempdir + `StdFs`.
2. In-process `with_fence` wrapper that pairs `MigrationFence` with a mutex (single-process
   stand-in for cross-process lock until platform adapter exists).
3. Evidence doc `GATE4D-JOURNAL-DURABLE-EVIDENCE.md` + focused integration test; no TS/Tauri wiring.

## Explicit non-goals for Slice B PR 1

- Production authority switch
- Gate 4E enable/disable refusal
- Gate 5 exhaustive writers
- Crash-injection / Gate 6 packaging
- QNB-192 CodeScene local preflight tooling

## Successor slices (not B)

- Slice C: record conversion / mixed-key inventory execution as live truth requires
- Gate 4E: first enable/disable closure
- Root two-phase commit coupling with step F when journal + root must advance together (may span B2)
