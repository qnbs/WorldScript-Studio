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
| Target root key ref (§10.1) | `has_target_root_key_ref`, `target_root_key_ref_digest`; required for `ENABLE`, `ROTATE`, and `BOOTSTRAP_TARGET` phase | bootstrap helper + encode/decode roundtrip |
| Final-inventory proof (§10.1.1, §10.3, Gate 4D slice D1) | `final_inventory_captured`, one strict byte after `journal_page_set_digest`; false before `ADMIT`, free in `ADMIT` and `RECOVERY_REQUIRED`, true from `CONVERT` on; the unreleased format is amended (no tag contains the codec, the crate is not a dependency of `src-tauri`), format version stays 1 | `the_final_inventory_flag_round_trips_and_is_one_strict_byte`, `the_final_inventory_flag_must_agree_with_the_phase` |
| Lease owner consistency | `validate_lease_fields`; encode refuses orphan lease fields | invalid lease field test |
| `inventory_digest` over canonical descriptor tuples | `inventory_digest`, `JournalInventoryEntry` | legacy settings entry; `verify_inventory` |
| Paged inventory without full in-memory flatten | `InventoryDigestVerifier`, `verify_inventory_pages` | `paged_inventory_verifier_matches_flat_digest` |
| Paged inventory bodies (`migration-page` payload) | `JournalPage` encode/decode, canonical re-encode on decode | page roundtrip; malformed refusal |
| Page generation / record class on page open | `JournalPage::open` | seal/open roundtrip with `page_ref_for` + envelope content digest |
| Page-set vs manifest binding (counts and digest) | `verify_page_set` | digest mismatch; per-page entry caps vs manifest `entry_count` |
| Inventory count/digest binding | `verify_inventory` | matching entries OK; wrong digest refused |
| Foreign `source_scheme_id` / `source_format_version` (§10.1.2) | registered scheme codes only for `FOREIGN_PROTECTED`; format version `1` for v1 schemes | `foreign_inventory_rejects_none_scheme_and_bad_format_version` |
| Lease owner id encode/decode symmetry | `validate_lease_fields` + bounded owner string on encode (`MAX_OPERATION_ID_LEN`) | `overlong_lease_owner_id_is_refused_on_encode` |
| Paged inventory without cloning all pages | `verify_inventory_pages` sorts `&JournalPage` references | `paged_inventory_verifier_matches_flat_digest` |
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
