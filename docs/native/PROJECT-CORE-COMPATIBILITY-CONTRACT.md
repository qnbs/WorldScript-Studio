# Project/Core Compatibility Contract

**Issue:** [#553](https://github.com/qnbs/WorldScript-Studio/issues/553)

**Status:** PROPOSAL — awaiting maintainer sign-off in §9. `PROPOSED = YES`,
`ADMITTED = NO (pending review)`, `IMPLEMENTATION_STARTED = NO`. This document changes no code and
switches no authority. It resolves the two decisions `CORE-MIGRATION-LEDGER.md` row 9 and issue
#553 identify as blocking further work on the Wave 2 project state-shape compatibility adapter —
and, transitively, the Wave 2 prerequisite gate that R-15 (#445) implementation sits behind.

**Baseline:** `main` at `f490360bab26bc068164d6226a03898b797b8e40`

**Owner:** the persisted project envelope itself, not any renderer, transport, or storage-security
layer (see §1.3 for why this is a distinct authority from every version number already in this
codebase).

**Scope:** Decides (1) where persisted project schema-version authority lives, its legacy/current/
future semantics, and its migration state machine; and (2) a field-class-staged unknown-field
policy that can never silently drop persisted user data. Defines the authority-switch admission
gates issue #553 asks for. Does not implement any of this, does not touch R-15/#445's separate
encryption-envelope security contract, and does not change current write authority (TypeScript
remains sole authority; the Rust shadow comparison remains observation-only).

## 1. Current truth (baseline)

### 1.1 The existing Rust migration proof is a harness demonstration, not production history

`crates/worldscript-project/src/envelope.rs` defines `CURRENT_SCHEMA_VERSION = 2` and a working
`V1ToV2` migration in `migrate.rs` that backfills `revision_note`. `schema.rs`'s own doc comment on
that field is explicit: "exists purely to give the Wave 2 headless harness a real migration to
prove, not a production field." **No real WorldScript project has ever been schema v1 or v2 in this
sense** — that version sequence describes a synthetic proof of the migration mechanism, not this
project's actual persisted history. Treating `2` as the starting point for real production
versioning would be truth drift: it would assert a project history that never happened.

### 1.2 TypeScript has no persisted version, and synthesizes one

`features/project/coreEnvelope.ts` synthesizes `CORE_PROJECT_SCHEMA_VERSION = 2` from a hardcoded
constant — `types.ts`'s `StoryProject` interface has no `schemaVersion` field at all today. Every
envelope built for the current shadow comparison therefore always claims to already be current,
regardless of a project's real age. This is exactly the failure mode issue #553 warns against: "do
not let a synthesized current version make older/unknown persisted data appear already migrated."

### 1.3 This version is not, and must not become, any other version number in this codebase

This codebase already has several distinct version concepts, and none of them is this one:

| Version | What it versions | Owner doc |
|---|---|---|
| App version (`package.json`) | The application build itself | `AGENTS.md` sync scripts |
| IndexedDB version | The browser storage schema | `services/storage/` |
| `contractVersion` | The TS↔Rust wire protocol | `docs/native/CONTRACT-VERSIONING-POLICY.md` (already correctly distinguishes this from project schema) |
| R-15 envelope version | The encrypted-record format, once R-15 ships | `docs/native/R15-SECURE-STORAGE-CONTRACT.md` |
| **Project schema version (this document)** | **The persisted project document's own shape** | **This document** |

Conflating any of these would make an unrelated bump (e.g. a Tauri or app-version release) look
like a project-format change, or vice versa. This document's `schemaVersion` describes the
persisted project document alone.

### 1.4 Unknown fields are silently dropped by default today

No struct in `schema.rs` carries `#[serde(deny_unknown_fields)]`; serde's default is to silently
ignore any JSON field it doesn't recognize on deserialize. Harmless for the current
observation-only comparison (nothing round-trips back to disk from Rust), but the most dangerous
possible default for a future authority switch. The real gap is large: `types.ts`'s `StoryProject`
already has fields Rust's `schema.rs` explicitly documents as out of scope for this first slice —
`outline`, `binderNodes`, `compileProfile`, `projectGoals`, `writingHistory` (`schema.rs`'s own
`StoryProject` doc comment names exactly these). A deserialize→reserialize round trip through the
current schema would silently erase every one of them today.

## 2. Decision 1 — Persisted schema-version authority

### 2.1 The envelope

The persisted project document owns its own `schemaVersion`, conceptually:

```json
{
  "schemaVersion": 1,
  "project": { "...": "..." }
}
```

The exact on-disk/on-wire representation (a wrapper object vs. a field on `StoryProject` itself) is
an implementation detail for the follow-up PR; what this document fixes is that the version belongs
to *the persisted project format itself*, is written by whichever side currently has write
authority (TypeScript, unchanged from today), and is never derived, inferred, or borrowed from any
other version in the table in §1.3.

### 2.2 First production version starts fresh at v1 — the synthetic Rust v1/v2 proof is retired

The first schema version any real WorldScript project is assigned is **`PROJECT_SCHEMA_V1`**,
defined fresh by this document against the actual current `StoryProject` shape (including the five
fields §1.4 names as currently unmodeled by Rust — being unmodeled by Rust does not mean absent
from the version-1 *format*; see §3 for how those fields are handled without being modeled). This
is a deliberately new, independent number sequence from Rust's harness-proof `1`/`2`. The existing
`V1ToV2` migration and `CURRENT_SCHEMA_VERSION = 2` in `envelope.rs`/`migrate.rs` remain valid as
what they already are — a proof that the migration *mechanism* works — but are not reinterpreted as
describing real project history once this contract is admitted. A follow-up implementation PR
should rename or annotate them to make this non-canonical status explicit in code, not only in this
document.

### 2.3 Legacy projects get a distinct sentinel, never silently treated as current

Every project persisted before this contract exists has no `schemaVersion` field. This state is
**`LEGACY_UNVERSIONED`** — a distinct classification, not a synonym for `PROJECT_SCHEMA_V1` and
never treated as the current version. Collapsing "no version" into "version 1" (this document's
original draft's mistake) risks exactly the semantic collision issue #553 warns about: a real,
years-old WorldScript project and a freshly-defined version-1 format are not the same thing, and a
future migration step needs to be able to tell them apart even if, today, they happen to require
the same treatment.

### 2.4 Version classification and state machine

```text
        ┌─────────────────────┐
        │ schemaVersion absent │──────▶ LEGACY_UNVERSIONED
        └─────────────────────┘
        ┌───────────────────────────┐
        │ schemaVersion == 1 (or any │
        │ future supported older N) │──────▶ SUPPORTED_OLDER
        └───────────────────────────┘
        ┌───────────────────────────┐
        │ schemaVersion == current  │──────▶ CURRENT
        └───────────────────────────┘
        ┌───────────────────────────┐
        │ schemaVersion > current   │──────▶ FUTURE
        └───────────────────────────┘
        ┌───────────────────────────┐
        │ malformed / unparseable   │──────▶ MALFORMED
        └───────────────────────────┘
```

Per-classification admission:

```text
LEGACY_UNVERSIONED  → CLASSIFIED → MIGRATION_REQUIRED → MIGRATED_IN_MEMORY
                        → NO_LOSS_VERIFIED → DURABLE_CURRENT
SUPPORTED_OLDER      → MIGRATION_REQUIRED → (same chain as above)
CURRENT              → NORMAL (read/write, no migration needed)
FUTURE               → REFUSE_WRITE_AUTHORITY (see §2.5)
MALFORMED            → RECOVERY / FAIL_CLOSED (existing preserve-first recovery UX, unchanged)
```

`LEGACY_UNVERSIONED` and `SUPPORTED_OLDER` both resolve through the *same* explicit migration path —
never a silent in-place relabel. Preserve-first applies throughout: the original persisted form is
retained until `NO_LOSS_VERIFIED` succeeds and the new form is durably committed (mirrors this
codebase's existing preserve-first storage rules; see §7).

### 2.5 Future version: fail closed, no automatic action

```text
persisted schemaVersion > this build's current supported version
        → UNSUPPORTED_FUTURE_VERSION
        → NO WRITE AUTHORITY
```

Never auto-migrate, never silently downgrade, never load-and-later-resave. The user-facing recovery
state may offer: use a newer WorldScript Studio version; preserve/export the original file
untouched; a strictly read-only inspection view *only* if write-back is provably impossible from
that view. No older client may ever save over a newer-versioned project. This mirrors the
`FutureVersion` philosophy `migrate.rs` already implements for the harness proof.

### 2.6 Downgrade: never automatic

A newer schema opened by an older client never auto-downgrades. If an explicit "export for an older
WorldScript Studio version" feature is ever wanted, it is a distinct, explicit, separately-scoped
export action that names any features/fields it cannot represent — never part of ordinary
open/save.

## 3. Decision 2 — Unknown-field policy is staged by field class, not one global choice

A single global policy is wrong here: the right answer depends on what kind of field is unknown.

| Field class | Policy | Why |
|---|---|---|
| Persisted data not yet modeled by Core at all (today: `outline`, `binderNodes`, `compileProfile`, `projectGoals`, `writingHistory`) | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | Core makes no claim about these fields' meaning; it must still never cause them to disappear from the persisted document. |
| Additive unknown fields inside an object Core *does* claim authority over (e.g. a future field added to `Character`) | `PRESERVE_OPAQUE` | Core understands the object's shape but not every field on it yet; the object round-trips losslessly while the unknown sub-fields wait to be modeled. |
| An unknown value for a closed, semantically load-bearing discriminant/enum Core must interpret to act correctly | `REJECT_UNKNOWN` | Silently passing through an unrecognized enum value risks Core acting on a wrong interpretation of it — failing closed is safer than opaque pass-through here. |
| Fields fully modeled and owned by Core today (`title`, `logline`, `characters[].id`, etc.) | `MODEL_AND_VALIDATE` | Already validated per-field; no ambiguity to resolve. |
| Forward compatibility with a not-yet-defined future field | Not an independent policy | Forward compatibility is the *result* of `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED`/`PRESERVE_OPAQUE` actually proving lossless preservation — never granted as a standalone default. |

`ALLOW_FORWARD_COMPATIBLE`, as a named policy distinct from the above, is not adopted: it would add
a fifth label with no distinct mechanism from `PRESERVE_OPAQUE`/`OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED`
already achieving the same effect where it's needed.

### 3.1 Mechanism: raw canonical payload as lossless carrier, typed projection for what Core owns

Rather than retrofitting `#[serde(flatten)] extra: Map<String, Value>` onto every struct in a large,
nested object graph (workable, but a source of subtle bugs as the graph grows — a flatten bucket on
a deeply nested struct is easy to lose track of), the preferred mechanism for this transition phase
is:

```text
persisted project document
        │
        ├── retained verbatim as the canonical raw JSON value (the lossless carrier)
        │
        └── Core produces a typed projection/verdict over only the fields it claims
            authority over today, validated per §3's table
```

Core's typed projection is a *view* with an opinion about the fields it understands; the raw
canonical payload remains the thing that is actually persisted until a specific field or object
graduates to genuine Core-owned authority. When a field graduates, its handling moves from
"preserved in the raw payload, ignored by the projection" to "modeled and validated by the
projection" — a change to what the projection covers, not to the wire format. A future
implementation PR should evaluate `#[serde(flatten)]` per-struct only where a specific object is
already fully Core-owned and needs additive-field tolerance (§3's second row) — not as a blanket
default across the whole graph.

## 4. No-loss round-trip — precise definition

"No loss" means, precisely:

- **Semantic JSON equality**, not byte-for-byte identity — key order and whitespace are not user
  data and are not part of this guarantee.
- **Exact preservation of every opaque/unmodeled value**, verbatim.
- **Array order preservation** for every ordered collection.
- **Stable ID preservation**, exactly (already proven for `characters`/`worlds` by
  `coreBoundaryAdapter.ts` — see §6).
- **No missing fields** relative to the source, and **no invented fields** except those an
  explicitly admitted migration step introduces (mirroring `revision_note`'s own honest doc comment
  about why it exists).

## 5. Authority-switch admission gates

Before the current `OBSERVATION_ONLY` shadow comparison may become any production decision/write
authority, all of the following are required — none are satisfied yet, and this document satisfies
none of them by existing:

1. Complete field inventory for the admitted lifecycle — every `StoryProject` field is either
   modeled, or explicitly and deliberately routed through §3's out-of-scope/opaque handling, never
   merely "not yet gotten to."
2. §2's version classification implemented and exercised against real historical projects, not only
   the synthetic harness shapes.
3. No-loss round-trip proof (§4) for every fixture class in §6.
4. TS/Rust accept/reject parity while both remain active during any transition window.
5. Rollback/fallback: the TS-authoritative path can still read whatever Rust most recently wrote.
6. Representative historical fixtures — real project shapes predating this contract, not only
   synthetic ones already shaped to match it.
7. No Redux-specific types leaking into Core — already satisfied structurally by
   `coreBoundaryAdapter.ts` (§6); re-verify at switch time.

## 6. Entity-state invariants — already satisfied, no change proposed

`coreBoundaryAdapter.ts`'s `entityStateToCoreArray`/`coreArrayToEntityState` and
`tests/unit/features/project/coreBoundaryAdapter.test.ts` already fail closed on duplicate IDs,
missing `ids`/entity correspondence, and orphan entities, and already preserve declared order and
stable IDs exactly. No change proposed here.

## 7. Relationship to preserve-first, R-15, and Qt

- **Preserve-first:** §2.4's migration chain (retain original until `NO_LOSS_VERIFIED` and durable
  commit) is this codebase's existing preserve-first storage principle applied to project-schema
  migration specifically — not a new principle invented here.
- **R-15 (#445):** a distinct security/durability contract for the encrypted-record envelope, key
  management, and migration — this document's `schemaVersion` is not R-15's envelope version (§1.3)
  and this document does not admit, implement, or modify any part of R-15's S5 contracts.
- **Qt:** any future Qt-side project consumer must read the same canonical raw payload + typed
  projection this document defines, never redefine its own project-schema rules — matching issue
  #553's own instruction that "Qt must consume this admitted Core boundary; QML must not recreate
  its own project schema rules."

## 8. Non-goals

- Any change to current write authority — TypeScript remains sole authority; Rust's shadow
  comparison remains `OBSERVATION_ONLY`.
- R-15 (#445)'s encrypted-storage envelope, key management, or migration contract.
- Modeling every currently-unmodeled `StoryProject` field in Rust immediately — §3 deliberately
  defers that to whenever each field actually graduates to Core-owned authority.
- Moving Redux reducers into Rust.
- Redesigning import UX.
- Any Qt vertical-slice work.
- Implementing any part of §2–§5 — this document proposes the contract; a follow-up PR implements
  it, with its own fixture/evidence matrix, exact-head CI, and CodeQL gate.

## 9. Maintainer decision record

Each row below is a single decision this document makes. Confirm, amend, or reject any row before
this proposal is treated as admitted:

| # | Decision | Status |
|---|---|---|
| 1 | Persisted `schemaVersion` belongs to the project document itself, distinct from app/IndexedDB/contract/R-15 versions (§1.3, §2.1) | ⬜ awaiting confirmation |
| 2 | First production version is a fresh `PROJECT_SCHEMA_V1`; Rust's existing harness `1`/`2` is not canonicalized as real project history (§2.2) | ⬜ awaiting confirmation |
| 3 | Absent version → `LEGACY_UNVERSIONED`, never silently treated as current (§2.3) | ⬜ awaiting confirmation |
| 4 | Future version → fail closed, no write authority, no auto-migration (§2.5) | ⬜ awaiting confirmation |
| 5 | Downgrade is never automatic (§2.6) | ⬜ awaiting confirmation |
| 6 | Unknown-field policy is staged by field class per §3's table, not one global policy | ⬜ awaiting confirmation |
| 7 | Mechanism: raw canonical payload as lossless carrier + typed Core projection, evaluated per-struct rather than blanket `#[serde(flatten)]` (§3.1) | ⬜ awaiting confirmation |
| 8 | No-loss definition per §4 (semantic equality, not byte-identical) | ⬜ awaiting confirmation |

Once confirmed, this document's status line updates to `ADMITTED = YES` and
`CORE-MIGRATION-LEDGER.md` row 9 is updated to reflect it, per issue #553's own acceptance
criterion. Implementation begins only in a separate, subsequent PR.
