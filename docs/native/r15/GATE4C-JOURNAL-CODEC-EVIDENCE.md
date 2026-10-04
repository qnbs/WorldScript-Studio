# Gate 4C — journal manifest and paged inventory codec

Owner: QNB-168 / GitHub #922 under program #445. Predecessor: Gate 4B protected operations (PR #954).
This slice is headless Core codec and authentication for §10.1 / §10.1.1 only — not durable journal
I/O, live-migration root binding execution, enable/rotate/recovery state machines, or a production authority
switch. Gate 4 remains partial until 4D/4E close.

## Acceptance matrix (§10.1 / §10.1.1 / §5.4 inventory)

| Requirement | Implementation | Focused proof |
|---|---|---|
| `journal_page_set_digest` domain, sort order, duplicate refusal | `journal.rs` | `gate4c_journal_test`: empty bootstrap constant; sort stability; duplicate page index |
| Bootstrap manifest body (`journal_revision = 0`, empty page set) | `JournalManifest` encode/decode | bootstrap roundtrip; `verify_page_set(&[])` |
| Manifest discriminants (`operation_type`, `phase`, `inventory_version`, fencing) | `validate_*` on encode/decode | invalid discriminants and orphan lease fields refused |
| §10.1 target root key ref on ENABLE/BOOTSTRAP paths | `has_target_root_key_ref`, `target_root_key_ref_digest` wire field | bootstrap helper + encode/decode roundtrip |
| Lease owner consistency | `validate_lease_fields`; encode refuses orphan lease fields | invalid lease field test |
| `inventory_digest` over canonical descriptor tuples | `inventory_digest`, `JournalInventoryEntry` | legacy settings entry; `verify_inventory` |
| Paged inventory without full in-memory flatten | `InventoryDigestVerifier`, `verify_inventory_pages` | `paged_inventory_verifier_matches_flat_digest` |
| Paged inventory bodies (`migration-page` payload) | `JournalPage` encode/decode, canonical re-encode on decode | page roundtrip; malformed refusal |
| Page generation / record class on page open | `JournalPage::open` | seal/open roundtrip with `page_ref_for` + envelope content digest |
| Page-set vs manifest binding (counts and digest) | `verify_page_set` | digest mismatch; per-page entry caps vs manifest `entry_count` |
| Inventory count/digest binding | `verify_inventory` | matching entries OK; wrong digest refused |
| Source-authority invariants (legacy / R15 / foreign scheme) | `JournalInventoryEntry::validate_semantics`, `source_scheme_id` | construction errors; adversarial decode paths |
| Identity / project-scope bindings (non-public mutators) | private binding fields + `validate_identity_bindings` | entry roundtrip and validation failures |
| Envelope seal/open for manifest and page records | `JournalManifest::seal/open`, `JournalPage::seal/open` (`JOURNAL_*_RECORD_SCHEMA`) | `manifest_and_page_seal_open_roundtrip` (revision ≥ 1 for seal counters) |
| Deterministic bounds (`MAX_*`) | constants + decode/encode checks | malformed/truncated inputs refused in tests |

Malformed or non-canonical bytes are refused entirely; no partial trust. No plaintext fallback.

## Evidence classification and deferred owners

Local evidence: `cargo test --test gate4c_journal_test`, default `cargo build`, and Clippy on the crate.
Linux Core CI runs the suite with the rest of `worldscript-secure-storage`. Platform secure-store jobs
are unchanged. Packaged power-loss and crash-resumable migration execution remain Gate 6 / 4D owners.

Deferred: durable journal persistence and checkpoint fsync ordering (4D where inseparable from execution),
live-migration binding updates on the authority root at runtime (4D), enable/disable and rotation state
machines (4E), full recovery executor, production caller wiring, and `PRODUCTION_AUTHORITY_SWITCH_ALLOWED = YES` (Gate 7).

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.
