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
| 4 | Logger / diagnostics | TS, `services/logger.ts` (312 lines) — dual-sink (IDB ring buffer + Tauri JSONL), single GDPR-redaction chokepoint | Medium (dual-sink dispatch is renderer-aware, but small) | Medium (redaction chokepoint) | Low | Low | Medium-high — small, self-contained | 3 — natural next fast-follow | Not started | Not started |
| 5 | Task-orchestration expansion | Rust, `src-tauri/src/commands/task_supervisor.rs` (310 lines, one task type) + TS `packages/worker-bus/` (5,130 lines, full orchestration surface) | worker-bus TS side is Web-Worker-pool coupled; Rust side already renderer-neutral in principle | Low-medium | Low (task results, not persisted project state) | Medium-high | High long-term, existing Rust is a narrow stub | 4 — natural next fast-follow | Not started | Not started |
| 6 | Storage — IDB backend (all encryption) | TS, `services/storage/` (18 files, 5,363 lines) — mature AES-256-GCM, ADR-0018 "Accepted and implemented" | High — IndexedDB is browser-only, not portable to Qt/GPUI as-is | High, mature | High | Medium | Low as literally written; high as a design reference | **Deferred to Wave 3-4** | None in Wave 2. ADR-0018's 6 invariants are required reading for Wave 3 crypto design | None in Wave 2 |
| 7 | `features/project/` domain logic | TS, `features/project/` (24 files, 2,114 lines) — real logic concentrated in `thunks/` + `projectSelectors.ts` (~450-500 lines); `reducers/` (11 files) is CRUD bookkeeping | High — Redux-store-shape/dispatch bound; `reducers/` stays TS-side permanently | Low | Medium (import/restore orchestration) | Low-medium | Medium (only the thunks/selectors subset) | Deferred | Candidate after the schema crate is proven; only thunks/selectors, never `reducers/` | Not started |
| 8 | AI services | TS, `services/ai/` (44 files, 5,401 lines), mixed portability (retry/routing/error-taxonomy renderer-neutral vs. `computeShaderFactory.ts`/`webGpuDetectorService.ts`/`.wgsl` inherently WebGPU-coupled) | Mixed | Medium-high (API keys) | Low-medium | Medium | Uncertain — too large/mixed to assess narrowly | **Out of scope for all of Wave 2** | None proposed | None |

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
- Rows 4-5 (logger, task-orchestration expansion) are the natural next fast-follows after this
  slice — both small and self-contained, with row 5 already having real Rust code to build on.

## What Wave 2's first slice does NOT do

No encryption (design or implementation) — Wave 3-4 only. No touching `services/storage/*` (IDB) or
reconciling it with fs storage. No `packages/worker-bus` subsumption or `task_supervisor.rs` task-
registry expansion. No `services/ai/*` work. No changes to `src-tauri/src/lora.rs` or `pandoc.rs`. No
Qt/GPUI code. No unifying `src-tauri/Cargo.toml` into one repo-root Cargo workspace (see
`crates/Cargo.toml`'s own scope note). No replacing `projectFsStore.ts`/`storageService.ts`'s
dispatch — any future Tauri-command wiring is additive-and-unused-by-default only. No
compression-format parity with the existing `.wsproj` files (open question, not solved here).
