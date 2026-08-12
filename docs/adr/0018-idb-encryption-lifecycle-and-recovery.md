# ADR 0018: IndexedDB encryption lifecycle and recovery

**Status:** Accepted. The durable journal and single-owner write gate are implemented; per-record conversion, recovery UX, and lifecycle operations remain unavailable.

## Context

WorldScript Studio stores protected content across two IndexedDB databases. A passphrase-derived, non-extractable AES-GCM key is held only in the current renderer session. A persisted encrypted sentinel proves that a library is configured for at-rest encryption.

Earlier code derived the write policy from whether the runtime key happened to be present. That made a configured-but-locked library indistinguishable from a library where encryption had never been configured. It also allowed disable and passphrase rotation to retire or replace the sentinel before every affected record had been safely converted.

These are recoverability and confidentiality defects, not ordinary preference failures.

## Decision

The encryption state is defined by persistent sentinel/journal metadata and runtime key availability, not by a single UI flag.

| State | Sentinel | Runtime key | Protected read/write policy | Allowed transition |
| --- | --- | --- | --- | --- |
| `DISABLED` | absent | absent | policy-covered stores may use their documented legacy format | set passphrase |
| `ENABLE_PENDING` | present or journaled | present | no claim of full-library coverage until verified migration completes | unlock/recover |
| `ENABLED_LOCKED` | present | absent | protected reads and durable writes fail with `STORAGE_LOCKED` | unlock |
| `ENABLED_UNLOCKED` | present | present | protected reads/writes use encrypted envelopes; legacy content may be read only while unlocked | lock, future journaled operation |
| `REKEY_PENDING` | source + journal | source/target keys supplied only at recovery time | normal writers blocked; migration owner checkpoints each store | resume or recovery-required |
| `DISABLE_PENDING` | source + journal | source key | normal writers blocked; each target record is verified plaintext before sentinel retirement | resume or recovery-required |
| `RECOVERY_REQUIRED` | journal | no assumed key | normal writers blocked; recovery requires the applicable passphrase(s) | resume or explicit support-led recovery |

The currently shipped foundation implements `DISABLED`, `ENABLED_LOCKED`, and `ENABLED_UNLOCKED`. It also persists a versioned journal and rejects a second migration owner before a conversion begins. It deliberately rejects disable and rekey requests until the pending conversion states can be completed and recovered.

## Invariants

1. A configured library never writes a policy-covered record in plaintext solely because the runtime key is absent.
2. A locked configured library does not expose legacy protected content through a special-case reader.
3. A disable operation may remove the sentinel only after every policy-covered record has been converted, read back, and semantically verified.
4. A rekey operation may make a target sentinel authoritative only after all records are checkpointed and readable through the recovery protocol.
5. No cross-database conversion is described as atomic. IndexedDB transactions are atomic only within one database transaction.
6. Journal metadata never contains a passphrase, raw key, or extractable `CryptoKey`.

## Durable journal protocol

The implemented journal is stored as versioned operational metadata, separate from protected content. It contains an operation ID, schema version, operation (`enable`, `rekey`, or `disable`), phase, source/target key generation identifiers, store checkpoints, and an optional target-key verifier. It does not contain key material. Creating a journal uses one state-database read/write transaction, so a concurrent owner is rejected instead of overwriting the active operation.

Every migration unit must follow this sequence:

1. Read and validate the source representation.
2. Write the target representation in a committed transaction.
3. Read it back and verify semantic equality.
4. Persist the checkpoint only after that verification.
5. Finalize the sentinel/key-generation metadata only after every store is complete.
6. Remove the journal in a separately recoverable cleanup phase.

Failure before cleanup leaves the journal and sufficient source/target verification material to resume deterministically. A corrupt journal transitions to `RECOVERY_REQUIRED`; it never triggers a database reset.

## Store scope and writer coordination

The conversion adapters must cover the policy-covered current stores in both databases: project/settings, snapshots, images, Codex, RAG vectors, and binder assets. They must also record intentionally excluded surfaces and why they are excluded.

Before conversion starts, the journal’s atomic owner gate blocks normal policy-covered reads and writes and rejects a concurrent migration owner. A cross-tab lease/notification path, stale-client reload requirement, and stale lease recovery remain required before lifecycle operations can be enabled.

## Consequences

The short-term consequence is that users cannot yet disable at-rest encryption or rotate its passphrase from the UI. This is preferable to claiming an operation succeeded while leaving unreadable ciphertext or silently downgrading content to plaintext.

The implementation must not re-enable these controls merely because a happy-path conversion test passes. It needs failure injection for transaction abort, quota exhaustion, reload between stores, corruption, and concurrent writers, plus packaged-webview validation.
