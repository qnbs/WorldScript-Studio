# S5-B3 — Chunked Large-Object Envelope

**Issue:** [#579](https://github.com/qnbs/WorldScript-Studio/issues/579), child of [#445](https://github.com/qnbs/WorldScript-Studio/issues/445)

**Status:** `S5_B3_ADMITTED = YES`. Admits the chunked envelope format `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §6.1.2/§6.3/§13 explicitly left as a fail-closed blocker. Production implementation not started.

**Baseline:** `docs/native/R15-SECURE-STORAGE-CONTRACT.md` at the S5-A baseline plus S5-B1 and S5-B2, merged to `main`. This document reuses the parent contract's already-admitted primitives without renegotiating them: the AES-256-GCM suite (§6.3), mandatory per-encryption CSPRNG nonces (§6.3 — never derived from a record ID, index, or revision), the §5.4 digest-set pattern (`catalog_set_digest`/`journal_page_set_digest`), and §6.2's tagged-identity bindings.

**Scope:** A chunked, per-chunk-authenticated envelope format and manifest for protected records exceeding the `64 MiB` whole-record `ciphertext_len` limit (§6.1.2). Nothing else — no change to the whole-record envelope, any S5-A/S5-B1/S5-B2 mechanism, or which classes are `PROTECTED`.

## 1. The gap this document closes

§6.3 already anticipates this exact need: "Large records: use bounded chunked records only with a separately versioned chunk envelope and domain-separated per-chunk AAD/nonces. Do not invent unauthenticated streaming AES. The initial implementation may reject records above its bounded whole-record limit until the chunk format is admitted." No such format exists anywhere in the S5-A baseline. Inspecting real source confirms this is reachable, not theoretical: `importBinderFileThunk` (`features/project/thunks/binderThunks.ts`) accepts a binder attachment of any size with no client-side cap, no UI-level size validation exists anywhere in the codebase, and research attachments (long audio recordings, scanned PDFs, video reference material) can realistically exceed `64 MiB` for a writing-research tool. Gate 5's per-class migrate-or-refuse requirement (§20) has no explicit refusal path for an oversized asset either — this document closes the gap by admitting the chunk format §6.3 already named, rather than leaving oversized assets permanently unrepresentable.

## 2. Chunk envelope (version 1)

**Applicability.** A protected record whose plaintext, once serialized under its normal §6.1.2 payload rules, would produce `ciphertext_len` exceeding the whole-record `64 MiB` limit uses this chunked form instead. A record within the limit MUST continue using the ordinary whole-record envelope — chunking is never chosen merely because it is available.

**Chunk sizing.** Fixed chunk size of `16 MiB` plaintext per chunk (a versioned constant — `CHUNK_PLAINTEXT_SIZE_V1`), except the final chunk, which holds the remainder and MAY be smaller. A record's chunk count is `ceil(plaintext_byte_length / CHUNK_PLAINTEXT_SIZE_V1)`, always at least `1` (a record only reaches this format because it exceeds the whole-record limit, so `chunk_count >= 1` always holds in practice, but the formula itself does not special-case zero-length input beyond what §6.1.2 already requires for any record).

**Per-chunk envelope.** Each chunk is its own complete `WSR1` envelope — its own 52-byte routing header (§6.1.2), its own ciphertext, its own 16-byte GCM tag — reusing `WSR1`'s existing version marker rather than introducing a second one: chunk-vs-whole-record dispatch is never inferred from envelope bytes alone, only from the marker's already-authenticated `is_chunked` flag (§4, below), which every caller reads before opening any envelope. Every chunk of one record generation shares the identical `envelope_version`/`suite_id`/`key_epoch`/`record_generation`/`record_schema` header fields — only each chunk's own `nonce` and `ciphertext_len` legitimately differ, since each chunk has distinct content and its own independently random nonce (§6.3). This chunk's own header (identical to every sibling chunk's except nonce/`ciphertext_len`) is what "header" means in the AAD formula below — never a separate, undefined "record-level" header:

```text
chunk AAD = domain || record_class || logical_record_id_binding || project_id_binding (§6.2,
            the containing record's own final-record identity bindings, identical for every chunk)
            || this chunk's own §6.1.2 header (§6.2's "header" component, above)
            || u32be(chunk_index)
            || u32be(chunk_count)
```

`chunk_index` is `0`-based and `chunk_count` is the record's total chunk count as defined above — both included directly in AAD, not merely in the manifest, so a chunk's own AEAD tag fails to authenticate if it is spliced into a different record, reordered, or paired with a different total count.

**Chunk physical locator.** `<record-class>-chunk:<logical-record-id>:<chunk-index>` names this chunk's promoted, post-commit physical location — the same generation-addressable naming style §9 step 7 already uses for a whole record — following the same canonical-decimal-identity-components rule (§5.4 of the parent contract) already used for `migration-page`'s `<page-index>`. It is a storage locator only — never independently authenticated or used to reconstruct identity by parsing; the record's own AAD-bound identity plus the AAD-authenticated `chunk_index` above already establish which record and position a given chunk's envelope belongs to. **During write (§6), before promotion, each chunk's staging form is this same locator with a temp suffix encoding the record-level write's own `operation_id`/`target_generation` from §9 step 2 — the identical `<target>.tmp-<operation-id>-<target_generation>` convention §9 step 3 already defines for a whole record's single staging file, applied once per chunk under the one shared per-record `PENDING` intent, never a chunk-scoped operation identity of its own.** This is what lets recovery (§6, below) distinguish this attempt's staged chunks from an earlier, superseded attempt's orphaned ones — the exact gap otherwise left open by treating the bare promoted-form locator as if it already carried operation identity.

## 3. `chunk_set_digest`

Analogous to `journal_page_set_digest` (parent contract §10.1.1), which is itself analogous to `catalog_set_digest` (§5.4) — the same precedented pattern, applied to a large record's chunk set instead of a migration journal's page set:

```text
"worldscript-r15/chunk-set/v1"
u32be(chunk_count)
for chunks sorted by chunk_index:
  chunk_index      u32be
  chunk_byte_length u32be  -- this chunk's own plaintext byte length (last chunk may differ from
                              CHUNK_PLAINTEXT_SIZE_V1; every non-final chunk must equal it exactly)
  chunk_content_digest 32 bytes; §5.4's content_digest formula applied verbatim to this chunk's
                                  own complete envelope bytes (its §6.1.2 header plus its
                                  ciphertext) — the same formula the whole-record envelope already
                                  uses, computed per chunk rather than once per record
```

`chunk_set_digest` is bound into the record's own commit marker body via the `is_chunked`/`chunk_count` extension (§4, below) — the marker's existing `content_digest` field is reinterpreted as `chunk_set_digest` when `is_chunked = 1`, never a second, separate digest field. A missing, duplicated, reordered, or count-mismatched chunk fails `chunk_set_digest` verification the same way an omitted or replayed catalog shard fails `catalog_set_digest` — this is the mechanism that defends against truncation (count mismatch), reordering, and duplication (per-index binding), independent of and in addition to each chunk's own AEAD tag.

## 4. Marker body extension

The parent contract's §5.4 `ACTIVE(1)` and `PENDING(2)`/`READ_AUTHORITY_PENDING(6)` marker bodies are updated directly (same PR) to append `is_chunked`/`chunk_count` as trailing fields **after** every field those bodies already define — never inserted earlier, so no existing field's position shifts:

```text
is_chunked          u8; 0 = the body's existing content_digest field is that envelope's own
                    §5.4 content_digest, unchanged from the pre-S5-B3 definition; 1 = that same
                    field is this record's chunk_set_digest (§3, above), and chunk_count follows
chunk_count         u32be, present only when is_chunked = 1
```

There is no separate "legacy" marker format this extension must remain compatible with: no S5 implementation exists yet, and every future implementation is built against the complete, unified specification (S5-A plus every merged S5-Bx document) rather than against S5-A in isolation. `is_chunked = 0` is the exact pre-S5-B3 behavior with two trailing bytes appended (a `u8(0)` and nothing else, since `chunk_count` is absent) — the golden vector required for whole-record compatibility (§7, below) proves this explicitly.

A record's chunked-vs-whole-record status is fixed at first write and MUST NOT change in place — converting between forms (e.g. a record shrinking below the whole-record limit) is a new write under the ordinary `PENDING(old -> new)` replacement flow (§9), never an in-place reinterpretation of an existing generation's `is_chunked` flag.

## 5. Read path

```text
1. authenticate the marker (§8.4); read is_chunked
2. is_chunked = 0: read/authenticate the single whole-record envelope exactly as §6.1.2/§9 already
                   specify — no change from the existing path
3. is_chunked = 1: read chunk_count chunk envelopes at chunk_index 0..chunk_count-1; authenticate
                   each independently (its own AEAD tag over its own AAD, above); recompute
                   chunk_set_digest over the authenticated set and require it to match the marker's
                   content_digest exactly
4. a missing chunk, a chunk failing its own AEAD tag, or a chunk_set_digest mismatch is a typed
   parse/authentication failure (§7 of the parent contract) — never a partial payload handed to the
   caller, and never reconstructed by treating the missing chunk as empty
5. once every chunk authenticates and the set digest matches, concatenate chunk plaintexts in
   chunk_index order to reconstruct the record's plaintext
```

## 6. Write path

**No new atomicity primitive is introduced.** Ordinary filesystem rename cannot atomically promote more than one file at once, and this document does not claim otherwise. Instead, exactly one thing is atomic — the marker commit (§9 step 9, the existing two-phase secure-anchor transition) — and every chunk is merely durably staged *before* that single atomic point, precisely mirroring how a whole-record write already stages one file durably before its own marker commit.

Chunked writes follow §9's existing ordinary-write contract with one extension applied per chunk between steps 3 and 6 (serialize, stage, write, sync): each chunk is independently serialized under its own AAD (§2), written to its own staging file, and flushed/synced (§9 steps 3-5, applied once per chunk, in any order or concurrently — chunks do not depend on each other's staging order). Only once *every* chunk's staging file is independently durable does `chunk_set_digest` get computed over the complete set (§3) and step 9's marker commit proceed, naming that digest. `DURABLE_COMMIT_SUCCESS` (§9.1) is reported only after the marker commit itself is durable — never after "all chunks staged" as some separate, weaker success condition.

**Recovery never assumes cross-file atomicity.** On restart, before the marker names a `chunk_set_digest`, no chunk is authoritative regardless of how many are durably staged — this is the same rule §9.2's fault-point table already states for a whole-record staging file ("Before staging write... old authority remains valid" through "After directory sync, before marker advancement... new bytes are durable but marker metadata is stale"). Recovery re-derives which chunks are already durably staged the same way §9.2 already resolves this for a whole-record staging file: the record's own durable marker names this attempt's `operation_id`/`target_generation` (§9 step 2), which fully determines every chunk's own legitimate staging suffix (§2, above) — recovery checks exactly the `chunk_count` expected `<record-class>-chunk:<logical-record-id>:<chunk-index>.tmp-<operation-id>-<target_generation>` staging locators that suffix names (never assuming a fixed promotion order), re-verifies each present chunk's own AEAD tag and content_digest, and either resumes staging the missing chunks and proceeding to the marker commit, or discards the entire partial set and restarts the write from the beginning. A staging file at the same chunk index but a *different* `operation_id`/`target_generation` suffix — left by an earlier, superseded attempt's own distinct `PENDING` intent — is never adopted merely because it also authenticates under the same final-record AAD (AAD carries no `operation_id`, §6.2, mirroring §9.2's identical whole-record rule exactly); it is untrusted atomic-write-temporary debris, reconciled per §3's atomic-write-temporary row and §9 step 11's generic stale-staging reconciliation, never treated as a second valid candidate and never routed through S5-B1's migration-time discovery mechanism (`docs/native/r15/MIGRATION-SOURCE-EVIDENCE.md` §5), which is scoped to legacy pre-R15 temp files discovered during migration inventory, not an already-operational R-15 write's own staging debris.

## 7. Required proof (headless, before production admission)

- A chunking-boundary fixture: exact chunk sizes at `CHUNK_PLAINTEXT_SIZE_V1 - 1`, `CHUNK_PLAINTEXT_SIZE_V1`, `CHUNK_PLAINTEXT_SIZE_V1 + 1`, and a multi-chunk record, proving `chunk_count` and per-chunk sizing match §2's formula exactly.
- A tamper fixture per chunk-set integrity property: a spliced chunk from a different record (AAD mismatch, fails independently of `chunk_set_digest`), a reordered chunk (index binding in AAD catches it), a duplicated chunk, and a truncated set (missing final chunk) — each must fail closed, never silently reconstruct a partial payload.
- A crash-recovery fixture covering a partial chunk promotion (some chunks durably promoted, marker not yet committed) — resumes or rolls back per §9's existing table, never reports success.
- A golden vector proving `is_chunked = 0` records use a byte-identical `WSR1` envelope to pre-S5-B3 whole-record writes, and a marker body identical to the parent's pre-S5-B3 §5.4 definition with exactly one trailing `is_chunked = 0` byte appended (`chunk_count` absent) — proving the append-only marker extension (§4) introduces no other change for non-chunked records.
- Update the parent contract's §6.1.2/§6.3/§13 blocker language, header status flags, and §21 to record `S5_B3_ADMITTED = YES` referencing this document (same PR, mirroring S5-B1/S5-B2's integration).

## 8. Non-goals

No implementation. No production authority switch. No change to the whole-record envelope, nonce policy, or any S5-A/S5-B1/S5-B2 mechanism. No new cryptographic primitive — this document reuses the existing AES-256-GCM suite and the existing digest-set pattern already proven for catalog shards and journal pages.
