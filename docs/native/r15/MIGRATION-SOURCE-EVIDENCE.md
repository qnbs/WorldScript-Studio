# S5-B1 — Canonical Migration Source & Payload Evidence

**Issue:** [#577](https://github.com/qnbs/WorldScript-Studio/issues/577), child of [#445](https://github.com/qnbs/WorldScript-Studio/issues/445)

**Status:** `S5_B1_ADMITTED = YES`. Admits the canonical source-evidence and destination-payload encodings that `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §10.1.2/§10.1.3/§10.4.1 explicitly left as fail-closed blockers. Production implementation not started.

**Baseline:** `docs/native/R15-SECURE-STORAGE-CONTRACT.md` at the S5-A baseline (PR #564) plus S5-B2 (PR #580), merged to `main`. This document extends §10.1–§10.6 without renegotiating any admitted semantics; every term below (`source_evidence_digest`, `source_value_digest`, `source_scheme_id`, `source_physical_authority_kind`, `LEGACY_PLAINTEXT`, `FOREIGN_PROTECTED`, `SOURCE_IDENTITY_UNBOUND`, `SOURCE_AUTHORITY_CONFLICT`) is the exact term the parent contract already defines.

**Scope:** Canonical source-evidence representation for plaintext packaged-IDB values; per-class `canonical_destination_payload_bytes`; `source_value_digest` value-equivalence; source representation/version registries; surviving atomic-write-temporary reconciliation; identity-upgrade/recovery for unbound AAD-less legacy sources and unidentified legacy quarantine data. Nothing else — this document does not reopen the digest contract's structure (§5.4), the migration phase state machine (§10.3), or any S5-B2/S5-B3 domain.

## 1. The four gaps this document closes

The parent contract left four fail-closed blockers naming this document as owner:

1. **§10.1.3** — `source_evidence_digest (LEGACY_PLAINTEXT)` is defined over exact frozen *file* bytes, but a packaged-desktop IndexedDB-fallback session persists structured-clone JS values via `compressData()` (`services/storage/idbCore.ts`) — neither a stable byte sequence that formula assumes when the value is stored unmodified.
2. **§10.1.3** — `canonical_destination_payload_bytes` (the coalescing input to `source_value_digest`) has no per-record-class codec for any `MIGRATE_TO_R15` class, so `source_value_digest` is unreproducible across independent Tauri/Qt adapters.
3. **§10.4.1** — surviving atomic-write temporaries (`<target>.tmp-<UUID>` files, §3) are not automatically junk but have no deterministic reconciliation rule against their owning record.
4. **§10.1.2/§3** — `SOURCE_IDENTITY_UNBOUND` (AAD-less legacy representations with no embedded identity) and legacy quarantine directories (no path-independent recovery-id persisted anywhere today) both block Gate 5/7 for their classes with no defined upgrade/recovery path.

## 2. Canonical JSON encoding (version 1)

**Why this is the load-bearing mechanism.** Inspecting every current persisted representation (below) shows the overwhelming majority of `MIGRATE_TO_R15` classes are JSON-object-shaped values, both on the Tauri filesystem (`services/fs/fsCore.ts#compressData` — `JSON.stringify(data)`, optionally LZ-compressed, always written as file text) and in the packaged-desktop IndexedDB fallback (`services/storage/idbCore.ts#compressData` — the raw JS value, *or* an LZ-compressed JSON string, chosen by a 10 KB threshold). A single canonical JSON encoding, not 28 bespoke per-class binary codecs, is the smallest mechanism that reproduces a stable byte sequence for every one of them — this is a deliberate scope-minimization choice, not an oversight of per-class nuance: no current class's schema requires a representation `JSON.stringify` cannot express.

**The actual gap in plain `JSON.stringify`.** ECMA-262 fully specifies both string escaping (`QuoteJSONString`) and number-to-string conversion for `JSON.stringify` — those are already deterministic across conformant engines for a *given* in-memory object. The genuine non-determinism is object **key order**: two independent implementations (the original TypeScript object and a from-scratch Rust reconstruction) can insert the same set of keys in different orders, producing byte-different `JSON.stringify` output for semantically identical data. Canonical JSON fixes exactly this, and nothing else.

**Encoding rule.** `canonical_json(value)` is defined recursively:

```text
null                -> the 4 ASCII bytes: null
true / false        -> true / false
number              -> ECMA-262 Number::toString applied to the value (already deterministic;
                        NaN/Infinity are not valid JSON and MUST be rejected before encoding)
string               -> ECMA-262 QuoteJSONString applied to the value (already deterministic)
array                -> [ elem_0 , elem_1 , ... ] in existing array order — arrays are already
                        ordered; never resorted
object               -> { key_0 : value_0 , key_1 : value_1 , ... } with keys sorted by their
                        exact UTF-8 byte sequence in ascending order — NEVER insertion order,
                        locale collation, or any engine's native enumeration order
```

**Duplicate keys.** `canonical_json` operates on an already-parsed in-memory value, which by construction has at most one value per key — a JS object cannot carry two properties with the identical name. For input reaching that value via standard `JSON.parse` on raw text, ECMA-262's `InternalizeJSONProperty` resolves a duplicate key deterministically (last occurrence wins, identically across every conformant engine) *before* `canonical_json` ever runs — this is already-canonical behavior, not a gap `canonical_json` needs to separately guard against. A boundary that accepts raw JSON text from an untrusted or adversarial source and needs to *detect* (not merely resolve) duplicate keys as a distinct signal — for example, flagging a possibly-tampered file — needs its own explicit duplicate-detecting scan of the raw text before parsing; this document does not require one for ordinary migration-source reading, since silent last-wins resolution is exactly what the current application itself already does and produces no cross-implementation disagreement.

No insignificant whitespace. This is the same sorting discipline the parent contract already uses everywhere else (inventory sort tuples, digest membership keys, marker-set entries) — extended to object serialization, not a new discipline invented for this document.

**`canonical_json_bytes(value) = UTF-8 encoding of canonical_json(value)`** is the single primitive every formula below builds on.

## 3. Source evidence for the packaged-IDB-fallback representation

`services/storage/idbCore.ts#compressData<T>(data: T): string | T` returns exactly one of:

- the raw value `data`, unmodified, when `JSON.stringify(data).length < 10_240` (structured-cloned into IndexedDB as an object/array/primitive — not a string, not bytes); or
- a string `"\x00lz1\x00" + LZString.compressToUTF16(JSON.stringify(data))`, when at or above that threshold.

`source_evidence_digest (LEGACY_PLAINTEXT, representation: packaged-IDB-fallback)`:

```text
SHA-256(
  "worldscript-r15/source-evidence/idb-fallback/v1"
  || u8(stored_form)   -- 0 = raw value, 1 = LZ-compressed string (the exact discriminator
                          compressData's own threshold already produces; never re-derived by
                          re-running JSON.stringify.length at hash time, which could disagree
                          with the value actually persisted if it changed since storage)
  || u64be(byte_length) || bytes
)
```

where `bytes` is:

- `canonical_json_bytes(data)` when `stored_form = 0` (the raw structured-cloned value); or
- the UTF-8 encoding of the exact stored string (including its `\x00lz1\x00` prefix) when
  `stored_form = 1` — the stored value is already a string; it is hashed as-is, never
  decompressed first, because decompression is not evidence, it is a separate authenticate-and-open
  step (`MigrationSourceAdapter.open_verified`, §15.3) that happens after evidence is frozen.

This is scheme/representation-specific mutation-detection evidence, per §5.4/§10.1's existing contract — it answers only "has the stored bytes changed since inventory," never cross-authority equivalence (§4, below). `source_format_version = 1` for this representation, following the same immutable-discriminator pattern the parent contract already uses for `WEBVIEW_IDB_AT_REST_V1`/`CREDENTIAL_IDB_KEYSTORE_V1`.

## 4. `canonical_destination_payload_bytes` and `source_value_digest`

The parent contract (§10.1.3) already defines:

```text
source_value_digest =
  SHA-256(
    "worldscript-r15/source-value-equivalence/v1"
    || canonical record-class token
    || tagged destination logical-record-id binding
    || tagged destination project-scope binding
    || u32be(destination_record_schema)
    || u64be(canonical_payload_byte_length)
    || canonical_destination_payload_bytes
  )
```

computed only after a candidate independently authenticates, opens, and passes no-transitive-trust identity validation. This document defines `canonical_destination_payload_bytes` for every class actually subject to cross-authority coalescing, sorted into buckets by that class's real current storage shape — never generalized beyond what exists. **Coalescing applies only where multiple physical authorities can genuinely hold the same logical identity** (the Tauri-filesystem-vs-packaged-IDB-fallback scenario §10.1.3 defines) — a class with no such fallback-duplicate scenario has no `source_value_digest` requirement at all, regardless of its shape.

**Excluded — no multi-authority scenario exists.** Library backups (a single user-selected external archive the user explicitly imports; §3 already classifies it "migration input only," never the R-15 envelope itself) and Quarantine/recovery data (a directory tree created by one specific corruption-recovery event, addressed by its own `recovery-id`, §6 — never duplicated across physical authorities). Both classes' evidence and integrity needs are fully covered by §3's existing `source_evidence_digest` and this document's §5/§6 mechanisms; they never need `canonical_destination_payload_bytes`.

**Bucket A — binary-native classes.** Binder binary assets; Local-first sync document (Yjs update log — a well-defined CRDT binary encoding); Analytics store (DuckDB/OPFS — a well-defined database file format). `canonical_destination_payload_bytes = the exact raw bytes of the parsed/decoded payload`, unchanged. No JSON or text encoding is involved at any point in their current representation.

**Global images (Bucket A, with one explicit decode step).** §3 states current image files are "plaintext base64 text despite the `.png` suffix" — the stored bytes are themselves a base64 *string*, not the decoded image. `canonical_destination_payload_bytes = the raw decoded image bytes`: reject the stored text if it is not valid standard-alphabet base64 with canonical padding (fail closed, never silently strip whitespace or repair padding), then decode. This makes the digest survive a future migration to storing raw bytes directly, and does not encode an arbitrary base64 line-wrapping or whitespace convention into the evidence.

**Bucket B — JSON-object-shaped classes.** Project/manuscript canonical data; Project metadata; Snapshots; Settings; Binder asset metadata; Story Codex; RAG/vector/index payloads; Worker dead-letter entries; Active-project marker; Logs/diagnostics; Cross-project search index; Scene comments and replies; Scene revision history; Plot-board and mind-map UI records; Writing progress and session history; ProForge memory bank; ProForge run history; AI inference cache; LoRA datasets and run metadata (`StoredDatasetEntry`/`StoredTrainingRun` — pure metadata, no blob fields); LoRA Redux mirror; Opt-in AI telemetry; AI benchmark history:

```text
canonical_destination_payload_bytes = canonical_json_bytes(parsed_value)
```

where `parsed_value` is the fully decompressed, JSON-parsed in-memory representation the current application already produces before use (`decompressData()` in either `idbCore.ts` or `fsCore.ts`, or the equivalent direct `JSON.parse` for an uncompressed file) — never the compressed/serialized wire form, and never re-derived by a from-scratch reconstruction that could omit or reorder fields the original never declared. This is the exact common ground that makes cross-authority coalescing well-defined: a filesystem-sourced and an IDB-fallback-sourced copy of the *same* logical record, once each is independently parsed into its natural in-memory shape, produce identical `canonical_json_bytes` if and only if they are semantically identical.

**Bucket C — mixed metadata+blob classes.** LoRA adapters (`services/loraAdapterService.ts#saveAdapter(meta, blob)` persists metadata and blob to two separate IDB stores under the same `id`, mirroring the parent contract's own asset-pair bytes/metadata split without renegotiating `lora:<adapter-id>`'s single existing identity, §5.2.1):

```text
canonical_destination_payload_bytes =
  u32be(byte_length(canonical_json_bytes(meta))) || canonical_json_bytes(meta) || raw blob bytes
```

Explicit length-prefixing avoids any implicit separator between the two parts, consistent with this contract family's existing AAD/digest encodings.

**Unknown or forward-compatible fields.** Canonical JSON encodes whatever keys the parsed value actually has. It never drops, reorders, or silently defaults a field the current schema does not recognize — an adapter that would need to discard data to compute this digest MUST instead return a typed source failure (§15.3), never silently degrade the digest's coverage.

## 5. Atomic-write-temporary reconciliation

The parent contract's §10.4.1 states surviving `<target>.tmp-<UUID>` temporaries are not automatically junk and blocks the authority switch on ambiguous owner/candidate state until this document admits the mechanics. Inspecting `services/fs/fsCore.ts#writeAndReplace` confirms the current implementation: a sibling `<target>.tmp-<UUID>` is created, written, and renamed over `<target>` on success, removed best-effort — meaning a crash between creation and removal can leave a temporary containing a complete, valid, but never-promoted alternate representation of `<target>`'s content.

**Discovery.** During migration inventory (§10.3 `DISCOVER`), for every file `<target>` a `MIGRATE_TO_R15` or `RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY` class owns, enumerate sibling files matching `<target>.tmp-*` in the same directory. A temporary is a candidate only if its owning `<target>` is independently identifiable — the temporary's own filename is a locator, never an identity source (the parent contract's existing anti-authority-from-filename rule, unchanged).

**Owner derivation.** A temporary's owner is resolved against the **class path registry** — the fixed set of canonical physical-path patterns each admitted class's existing `services/fs/*` convention already defines (e.g. `$APPDATA/snapshots/<numeric-id>.json`, `$APPDATA/projects/<project-id>/...`) — never against whether a promoted record currently exists at that path. A crash before a record's *first-ever* promotion leaves `<target>` absent entirely; the temporary is still a valid candidate for the identity that path pattern names, exactly as if `<target>` existed and were merely stale. A prefix is an **orphan** only when no admitted class's path pattern matches it at all — never merely because the specific file is not currently present: preserve every orphan, never delete it automatically, and surface it as a recovery-required artifact requiring explicit disposition (a future admitted class might claim it).

**Candidate evidence.** `source_evidence_digest` for a temporary candidate uses the same formula as its owning record's LEGACY_PLAINTEXT evidence (§3, above, or the parent contract's file-bytes formula, depending on which physical authority owns `<target>`) — computed over the temporary's own content, never the promoted target's.

**Canonical-target comparison.** Parse both the temporary and the current `<target>` (when `<target>` exists and is readable) into their natural in-memory representations and compare via `canonical_json_bytes` (Bucket B) or raw-byte equality (Bucket A):

```text
temporary content == target content (by the applicable bucket's equality test)
    -> the temporary is a redundant, fully-superseded artifact: eligible for cleanup once the
       owning record's own migration/retention disposition is otherwise satisfied — never deleted
       merely because it is redundant, on its own, ahead of that disposition

temporary content != target content (both parse successfully)
    -> CONFLICTING_CANDIDATE: preserve both, never guess which is authoritative by mtime or
       recency, block the authority switch for that identity — the same SOURCE_AUTHORITY_CONFLICT
       posture §10.1.3 already uses

target missing or unreadable, temporary parses successfully
    -> the temporary is the only complete candidate for that identity (including the crash-before-
       first-promotion case, above); treat it as the record's LEGACY_PLAINTEXT source for migration
       purposes, never silently promoted in place without going through the same authenticated
       write path (§9) as any other record

target parses successfully, temporary is corrupt/truncated/unparseable
    -> preserve both; never infer authority from the readable target alone merely because the
       temporary failed to parse — a partially-written temporary can still be evidence of an
       in-flight mutation the target's own generation does not yet reflect; block the authority
       switch for that identity pending explicit disposition, the same preserve-and-block posture
       as CONFLICTING_CANDIDATE, above

both missing or unreadable
    -> RECOVERY_REQUIRED for that identity, never silently treated as ABSENT
```

**Cleanup eligibility.** A temporary becomes eligible for physical deletion only after: (a) it is classified redundant per the comparison above, AND (b) its owning record's own migration disposition has reached a durable state that no longer needs it for rollback (mirroring §10.3's `RETIRE_OLD_AUTHORITY`/`FINALIZE` retention discipline). Eligibility never implies immediate deletion, exactly as §5.3's finalization-is-not-deletion principle already establishes elsewhere in this contract family.

## 6. Identity-upgrade/recovery for unbound sources and legacy quarantine

**`SOURCE_IDENTITY_UNBOUND` (§10.1.2) — scoped to `MIGRATE_TO_R15` sources only.** The parent contract returns this typed outcome when a representation-1 (AAD-less) legacy plaintext value, or a `CREDENTIAL_IDB_KEYSTORE_V1` credential, authenticates but carries no independent embedded identity proof. This document admits exactly one upgrade path, and it applies **only to sources whose admitted disposition (§10.4.1) is `MIGRATE_TO_R15`**: **explicit user-confirmed re-keying**. Core surfaces the ambiguous source (its physical locator and, where safely displayable, non-sensitive descriptive metadata) to the user, who explicitly confirms which destination identity it belongs to; Core then writes it under that confirmed identity through the ordinary authenticated write path (§9), which mints a fresh, properly AAD-bound envelope — this is a **new write**, never a re-export or re-encryption of the ambiguous source in place. No implementation may infer this binding automatically from content, filename, or physical proximity to another record.

**Credentials are explicitly excluded from this procedure.** `CREDENTIAL_IDB_KEYSTORE_V1`'s disposition is `RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY` (§10.4.1) — credentials must never be folded into the ordinary §9 R-15 envelope/generation/epoch model under any circumstance, including this upgrade path, because doing so would give the renderer or an ordinary record-read path a way to observe credential ciphertext structure the dedicated authority deliberately isolates (§10.4.1's own stated rationale, unchanged). An unbound credential therefore has **no admitted recovery procedure in S5-B1**: it remains blocked, exactly as `SOURCE_IDENTITY_UNBOUND` already requires, and any future credential re-key mechanism needs its own dedicated contract under credentials' native-secret-authority disposition — never this document's `MIGRATE_TO_R15`-scoped write path.

A `MIGRATE_TO_R15` source with no available user-confirmation path (fully unattended migration) remains blocked — `SOURCE_IDENTITY_UNBOUND` is a permanent refusal for that identity in that mode, not a retryable transient state.

**Legacy quarantine recovery-id (§3).** `services/fs/projectFsStore.ts#quarantineProject` persists only the physical directory name (`<project>-corrupt-<timestamp>`); no path-independent `recovery-id` exists in `legacy-auxiliary.json` or elsewhere today. This document admits: at migration inventory time, Core assigns a fresh, Core-generated `recovery-id` (the same 128-bit random-hex construction as `InstallationScopeId`, §5.2.2 of the parent contract — reusing an already-admitted identity primitive rather than inventing a new one) to each discovered quarantine directory, and durably records the `<directory-name> -> recovery-id` mapping as part of the migration journal's own inventory (§10.1) before that quarantine record's `recovery:<original-project-id>:<recovery-id>` identity is used anywhere else. This is an *assignment*, not a *derivation* — it does not, and cannot, reconstruct any recovery-id a hypothetical prior scheme might have intended, because no such value was ever persisted. The physical directory name remains what it always was: a locator, never identity.

## 7. Required proof (headless, before production admission)

- Canonical JSON golden vectors: object key-order independence (two different insertion orders for the same key set produce identical `canonical_json_bytes`), array order preservation, string/number encoding fixtures, and a raw-text duplicate-key fixture proving `JSON.parse`'s last-wins resolution is identical across the target engines before `canonical_json` runs.
- A round-trip fixture per Bucket A/B class demonstrating `canonical_destination_payload_bytes` reproduces identically from both a Tauri-filesystem-sourced and an IndexedDB-fallback-sourced copy of semantically identical content.
- A `source_evidence_digest (idb-fallback)` fixture covering both `stored_form` values, including a mutation-detection case (evidence digest changes when stored content changes).
- An atomic-write-temporary fixture exercising every branch of §5's comparison table, including the orphan and both-missing cases.
- A `SOURCE_IDENTITY_UNBOUND` upgrade-path fixture proving the confirmed re-key writes a fresh envelope through §9 rather than mutating the ambiguous source, and that unattended mode never resolves it automatically.
- A quarantine recovery-id assignment fixture proving the mapping is durable before first use and stable across restart.

## 8. Non-goals

No implementation. No production authority switch. No change to any S5-A digest structure, S5-B2's `AuthoritySnapshotGuard`, or S5-B3's chunked-envelope domain. No new cryptographic primitive — canonical JSON is a serialization discipline, not a cipher or KDF change.
