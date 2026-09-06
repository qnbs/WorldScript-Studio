# Core Migration Ledger

Tracks, per capability, where its authoritative implementation currently lives and what Wave moves
it (if at all) into the renderer-neutral Rust Core. See `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` §15
for wave definitions and `docs/adr/0021-qt-gpui-native-desktop-strategy.md` for the strategic
decision this serves. First populated for Wave 2's first slice (2026-08-20); update this table as
scope shifts — it is a living decision record, not a one-time snapshot.

| # | Capability | Owner (lang/module) | Renderer coupling | Security sensitivity | Data-integrity sensitivity | Performance sensitivity | Native-reuse value | Migration priority | Migration strategy | Compatibility tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Project schema | TS, `types.ts` (916 lines) — `StoryProject`/`Character`/`World`/`StorySection`/`Settings` | Medium — `characters`/`worlds` are typed `Character[] \| EntityState<Character, string>`, a Redux Toolkit coupling at the type level | Low | High — canonical shape everything else depends on | Low | High — every renderer needs the same shape | **1 — Wave 2 first slice** | Port the array-only member of the union to Rust structs (serde, camelCase); TS type left unchanged | Golden-master JSON fixtures decode identically in Zod and Rust |
| 2 | Validation | TS, `services/projectImportSchema.ts` (352 lines, Zod, import-only) + `idbProjectStore.ts#validateAndFixState` (hand-written repair-on-load, separate path) | Low, but split across two divergent implementations today | Low-medium (first line of defense against malformed/malicious import files) | High | Low | High | **1 — Wave 2 first slice** | Hand-rolled Rust validation mirroring the Zod ruleset for the modeled fields; does not reconcile the Zod-vs-hand-written TS divergence | Same golden-master fixtures; accept/reject parity asserted per fixture |
| 3 | Storage — fs backend (plain load/save) | TS, `services/fs/` (7 files, 1,253 lines) | High today (Tauri-fs-plugin coupled) | Low today — `fsCore.ts#encryptText`/`decryptText` are dead code, zero call sites | High (atomic-write semantics, compression) | Medium (large-project I/O) | High | **2 — Wave 2 first slice, narrow** | New crate proves plain JSON load/save on its own format; does not replace `projectFsStore.ts` | Round-trip identity tests inside the new crate only, not yet byte-compared against `.wsproj` |
| 4 | Logger / diagnostics | TS, `services/logger.ts` (public API + in-memory cache) with `services/diagnostics/logEntry.ts` (portable model/redaction) and `services/diagnostics/logSinks.ts` (IDB ring buffer + Tauri JSONL + dev console), plus Rust Core proof in `crates/worldscript-diagnostics` | Medium (dual-sink dispatch remains renderer-aware) | Medium (redaction chokepoint) | Low | Low | Medium-high — small, self-contained | 3 — Wave 2 fast-follow | **In progress — Core model/redaction and TS/Rust parity are CI-proven; recursive redaction and the typed TS sink boundary are locally proven in #441 and CI merge-gated; no authority switch** | Shared JSON fixtures are exercised independently by Rust and TS for recursive redaction and LogEntry wire shape; browser/Tauri sink adapters now consume the portable TS LogEntry; sink parity and production wiring remain open |
| 5 | Task-orchestration expansion | Rust, `src-tauri/src/commands/task_supervisor.rs` (bounded `text.analyze`/`text.diff`) + TS `packages/worker-bus/` (5,130 lines, full orchestration surface) | worker-bus TS side is Web-Worker-pool coupled; Rust side is renderer-neutral for the bounded proof | Low-medium | Low (task results, not persisted project state) | Medium-high | High long-term, existing Rust is a narrow stub | 4 — Wave 2 fast-follow | **Bounded task proof CI-proven in #430; full extraction not started** | Rust tests cover structured failure, input bounds, deterministic analysis, diff parity, and the v1.0.0 request/result contract; no broad worker-bus authority switch |
| 6 | Storage — IDB backend (all encryption) | TS, `services/storage/` (18 files, 5,363 lines) — mature AES-256-GCM, ADR-0018 "Accepted and implemented" | High — IndexedDB is browser-only, not portable to Qt/GPUI as-is | High, mature | High | Medium | Low as literally written; high as a design reference | **Deferred to Wave 3-4** | None in Wave 2. ADR-0018's 6 invariants are required reading for Wave 3 crypto design | None in Wave 2 |
| 7 | `features/project/` domain logic | TS, `features/project/` (24 files, 2,114 lines) — real logic concentrated in `thunks/` + `projectSelectors.ts` (~450-500 lines); `reducers/` (11 files) is CRUD bookkeeping | High — Redux-store-shape/dispatch bound; `reducers/` stays TS-side permanently | Low | Medium (import/restore orchestration) | Low-medium | Medium (only the thunks/selectors subset) | Deferred | Candidate after the schema crate is proven; only thunks/selectors, never `reducers/` | Not started |
| 8 | AI services | TS, `services/ai/` (44 files, 5,401 lines), mixed portability (retry/routing/error-taxonomy renderer-neutral vs. `computeShaderFactory.ts`/`webGpuDetectorService.ts`/`.wgsl` inherently WebGPU-coupled) | Mixed | Medium-high (API keys) | Low-medium | Medium | Uncertain — too large/mixed to assess narrowly | **Out of scope for all of Wave 2** | None proposed | None |
| 9 | Project state-shape compatibility adapter | TS, `features/project/coreBoundaryAdapter.ts` at the Core boundary + Rust, `crates/worldscript-project` schema | High at the boundary — production Redux `EntityState` must be translated without importing Redux into Core | Low | High — ID/order preservation is part of project identity | Medium | High — every native renderer needs the same conversion contract | **2 — Wave 2 prerequisite before G1 evaluation** | **In progress — `IMPLEMENTATION_STARTED = YES`; Slice A's persisted-version classification and TS/Rust parity (including raw-token grammar) are implemented, and Slice B's first observation-only IDB ingress is wired; no authority switch**; normalizes array or Redux `EntityState` to renderer-neutral arrays and reconstructs the TS-side shape only at the integration boundary. The Rust verdict remains partial because unknown fields are not rejected and no canonical raw carrier exists yet. Both required decisions (persisted version authority; a field-class-staged unknown-field policy, not one global policy) are resolved and maintainer-admitted in [`docs/native/PROJECT-CORE-COMPATIBILITY-CONTRACT.md`](PROJECT-CORE-COMPATIBILITY-CONTRACT.md), `PROPOSED = YES` / `ADMITTED = YES` — issue #553 remains open until the admitted contract is implemented (Slices A–F). | `tests/unit/features/project/coreBoundaryAdapter.test.ts` covers array and `EntityState` inputs, round-trip ID/order preservation, and rejection of duplicate IDs, missing references, and orphaned entities for both characters and worlds; `tests/unit/features/project/projectSchemaVersion.test.ts` and `crates/worldscript-project/tests/version_test.rs` cover classification/parity; the IDB load observation is covered by `tests/unit/services/storage/idbProjectStoreLoadStateObservation.test.ts`; the envelope fixture is accepted by Rust after migration and validation |
| 10 | R-15 protected desktop storage contract | **Design only (S5-A baseline)**, `docs/native/R15-SECURE-STORAGE-CONTRACT.md`; current desktop records remain TS/Tauri filesystem authority | High — future Core must serve Tauri and Qt without renderer-private crypto semantics | High | High — durability, migration, and identity binding protect user data | High | **Highest — cross-renderer security/durability contract** | **3 — S5-A, S5-B1, S5-B2, and S5-B3 all admitted; final cross-contract audit complete, S5_TERMINAL pending this PR's own merge** | **S5_A_ADMITTED=YES / S5_B1_ADMITTED=YES / S5_B2_ADMITTED=YES / S5_B3_ADMITTED=YES / S5_IMPLEMENTATION_READY=NO / S5_TERMINAL=NO (pending)**; inventory, identity/AAD envelope, key epochs, fail-closed reads, durable replacement, crash-resumable migration, unified admission, race-free `AuthoritySnapshot` acquisition/lifetime (`docs/native/r15/AUTHORITY-SNAPSHOT-LIFETIME.md`), canonical migration source/payload evidence (`docs/native/r15/MIGRATION-SOURCE-EVIDENCE.md`), and the chunked large-object envelope (`docs/native/r15/CHUNKED-LARGE-OBJECT-ENVELOPE.md`) are all specified. No production authority switch or plaintext migration is claimed. | Final S5 cross-contract consistency audit (mutual reference integrity across all four documents) is complete — two mechanical citation-drift notes (a stale disposition-count note in §10.4.1, and S5-B3's mis-citation of S5-B1's migration-time mechanism for its own ordinary-write staging debris) and three substantive gaps were corrected: S5-B3's chunk-locator carried no operation/generation identity, so recovery could not distinguish a superseded attempt's orphaned chunk from the current one; §10.4.1's atomic-write-temporary-files carve-out contradicted its own "exactly one of three groups" exhaustiveness claim; and fixing that carve-out into an explicit `REFUSE_AUTHORITY_SWITCH` group in turn made Gate 7's class-level rule permanently unsatisfiable for that one class, fixed by making Gate 7 instance-aware. `S5_TERMINAL` is set to YES only in a dedicated follow-up commit once this PR merges and its own post-merge main CI (incl. CodeQL) is confirmed green. Headless Core vectors, fault-injection tests, per-record migration tests, packaged durability evidence, and explicit #357/#359/#360/#361 reconciliation are still required before implementation gates can close |

## Decisions this table records

- **Wave 2 first slice touches only rows 1-3**, narrowly: project schema, validation, and a
  plaintext (no compression, no atomicity guarantee) fs load/save round-trip. This is deliberately
  the smallest slice that satisfies Wave 2's stated exit criterion ("representative project
  lifecycle executes without any GUI runtime") — see `crates/worldscript-project/`.
- **Row 6 (IDB encryption) is the mature reference design for Wave 3-4**, not a Wave 2 target. It
  stays fully TS-side and untouched; only its *design* (ADR-0018's invariants, the journal/
  checkpoint/lease saga) informs the future Rust crypto module.
- **Row 8 (AI services) is explicitly out of scope for all of Wave 2**, not just this slice — it is
  too large (5,401 lines) and too mixed in portability (WebGPU-coupled pieces have no Rust path) for
  a clean narrow extraction. Revisit only once rows 1-5 are proven.
- **Row 9 is a required compatibility position before G1 is evaluated.** The Core's deliberate
  `Vec`-based model is not the Redux `EntityState` shape; the adapter contract, its ID/order
  fixtures, and a first observation-only desktop caller are now proven at the boundary. This does
  not move Redux reducers or make `EntityState` part of Core, and it does not make the Rust verdict
  authoritative.
- **Row 9 boundary policy is deterministic for both `characters` and `worlds` and is now
  implemented in `features/project/coreBoundaryAdapter.ts`.** Array-to-`EntityState` conversion
  rejects duplicate or missing stable IDs. `EntityState`-to-array conversion rejects an `ids`
  entry without a matching entity, an entity absent from `ids`, or duplicate IDs; it never silently
  drops, synthesizes, or last-write-wins. Valid input preserves the declared `ids` order and
  entity IDs in the boundary fixtures. The first caller observes a synthesized, partial envelope
  only; this proves the boundary integration, not complete validation or an authority switch.
- **Row 4 has a narrow CI-proven Core proof and a locally proven, CI-merge-gated typed sink
  boundary.** `crates/worldscript-diagnostics` owns only the typed structured-log model and the
  recursive key-redaction semantics; PR #437 established the original parity contract and #441
  extends it with recursive coverage. The browser/Tauri sink adapters now receive the portable
  TypeScript `LogEntry` from `services/diagnostics/logSinks.ts`; IDB, Tauri JSONL, and
  development-console ownership remains renderer-specific, and no production caller or authority
  switch is claimed.
- Row 5 is already locally and CI-proven as a bounded Tauri supervisor proof (`text.analyze` and
  `text.diff`, with structured failure semantics); full worker-bus extraction and G1 completion remain open.

## What Wave 2's first slice does NOT do

No encryption (design or implementation) — Wave 3-4 only. No touching `services/storage/*` (IDB) or
reconciling it with fs storage. No `packages/worker-bus` subsumption or `task_supervisor.rs` task-
registry expansion. No `services/ai/*` work. No changes to `src-tauri/src/lora.rs` or `pandoc.rs`. No
Qt/GPUI code. No unifying `src-tauri/Cargo.toml` into one repo-root Cargo workspace (see
`crates/Cargo.toml`'s own scope note). No replacing `projectFsStore.ts`/`storageService.ts`'s
dispatch — any future Tauri-command wiring is additive-and-unused-by-default only. No Row-9
  authority switch is included in this slice; the typed boundary contract, fixtures, and one
  observation-only desktop caller are proven independently. The caller's envelope is synthesized
  and partial, and unknown persisted fields are outside its verdict. No sink migration, Tauri adapter
rewiring, or authority switch is included in the logger proof. No compression-format parity with
the existing `.wsproj` files (open question, not solved here).
