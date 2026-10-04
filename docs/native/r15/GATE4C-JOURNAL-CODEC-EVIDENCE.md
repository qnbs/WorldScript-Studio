# Gate 4C — journal manifest and paged inventory codec

Owner: QNB-168 / GitHub #922 under program #445. Predecessor: Gate 4B protected operations (PR #954).
This slice is headless Core codec and authentication for §10.1 / §10.1.1 only — not durable journal
I/O, live-migration root binding, enable/rotate/recovery state machines, or a production authority
switch. Gate 4 remains partial until 4D/4E close.

## Acceptance matrix (§10.1 / §10.1.1 / §5.4 inventory)

| Requirement | Implementation | Focused proof |
|---|---|---|
| `journal_page_set_digest` domain, sort order, duplicate refusal | `journal.rs` | `gate4c_journal_test`: empty bootstrap constant; sort stability; duplicate page index |
| Bootstrap manifest body (`journal_revision = 0`, empty page set) | `JournalManifest` encode/decode | bootstrap roundtrip; `verify_page_set(&[])` |
| `inventory_digest` over canonical descriptor tuples | `inventory_digest`, `JournalInventoryEntry` | legacy settings entry; `verify_inventory` |
| Paged inventory bodies (`migration-page` payload) | `JournalPage` encode/decode, canonical re-encode on decode | page roundtrip; malformed refusal |
| Page-set vs manifest binding | `verify_page_set` | explicit digest mismatch → `PageSetMismatch` |
| Inventory count/digest binding | `verify_inventory` | matching entries OK; wrong digest refused |
| Source-authority invariants (legacy / R15 / foreign) | `JournalInventoryEntry::validate_semantics` | construction errors in entry tests; adversarial decode paths via corrupt bytes |
| Envelope seal/open for manifest and page records | `JournalManifest::seal/open`, `JournalPage::seal/open` | covered by existing record codec integration; no durable filesystem write in 4C |
| Deterministic bounds (`MAX_*`) | constants + decode/encode checks | malformed/truncated inputs refused in tests |

Malformed or non-canonical bytes are refused entirely; no partial trust. No plaintext fallback.

## Evidence classification and deferred owners

Local evidence: `cargo test --test gate4c_journal_test`, default `cargo build`, and Clippy on the crate.
Linux Core CI runs the suite with the rest of `worldscript-secure-storage`. Platform secure-store jobs
are unchanged. Packaged power-loss and crash-resumable migration execution remain Gate 6 / 4D owners.

Deferred: durable journal persistence and checkpoint fsync ordering (4C follow-on or 4D where inseparable),
live-migration binding updates on the authority root (4D), enable/disable and rotation state machines (4E),
full recovery executor, production caller wiring, and `PRODUCTION_AUTHORITY_SWITCH_ALLOWED = YES` (Gate 7).

`PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO`.
