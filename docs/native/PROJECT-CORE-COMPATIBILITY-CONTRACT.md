# Project/Core Compatibility Contract

**Issue:** [#553](https://github.com/qnbs/WorldScript-Studio/issues/553)

**Status:** ADMITTED — maintainer-approved at the contract/design level, including §9's decision
rows 1–19 and the post-signoff refinements recorded below them. `PROPOSED = YES`, `ADMITTED = YES`,
`IMPLEMENTATION_STARTED = NO`. This document changes no code and switches no authority. It resolves
the two decisions that `CORE-MIGRATION-LEDGER.md` row 9 and issue `#553` both identify as blocking
further work on the Wave 2 project state-shape compatibility adapter — and, transitively, the Wave 2
prerequisite gate that R-15 (`#445`) implementation sits behind. Implementation begins only in a
separate, subsequent PR per issue `#553`'s own slices.

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
possible default for a future authority switch.

### 1.5 The real persisted surface is larger than `StoryProject` — `StoryProject` is itself already a narrowed view

`types.ts`'s `StoryProject` interface — the type `coreEnvelope.ts`'s `buildCoreProjectEnvelope`
takes — is not the full persisted project. The actual runtime/persisted shape is
`features/project/projectState.ts`'s `ProjectData`, which `services/storageBackend.ts`'s
`normalizeSaveProjectInputToStoryProject` narrows to `StoryProject` only at the *type* level (`return
project.data as StoryProject` — a cast, not a field-by-field copy; the real object retains every
`ProjectData` field at runtime). `buildCoreProjectEnvelope` then explicitly picks only `title`,
`logline`, `author`, `characters`/`worlds` (via `toCoreProjectCollections`), and `manuscript` when
constructing the shadow-validation envelope. Two narrowing steps exist today, not one:

```text
ProjectData (actual persisted/Redux shape, ~20 fields)
        │  narrowed by a type cast only — no fields actually removed at runtime
        ▼
StoryProject (types.ts interface, 11 fields)
        │  narrowed by explicit field-picking in coreEnvelope.ts
        ▼
Core shadow-validation envelope (title/logline/author/characters/worlds/manuscript only)
```

`schema.rs`'s own `StoryProject` doc comment names `outline`, `binderNodes`, `compileProfile`,
`projectGoals`, `writingHistory` as out of scope — but that comment is scoped to the gap between
`types.ts`'s `StoryProject` interface and Rust's model, which is only the *first* narrowing step
above. `ProjectData` additionally carries `id`, `relationships`, `writingSessions`, `writingGoals`,
`sceneBoardLayout`, `persistedVersionControl`, `plotConnections`, `plotSubplots`,
`plotTensionOverrides`, `aiPreset`, `storyObjects`, `objectGroups`, `mindMaps`, and
`characterInterviews` — none of which reach the current shadow envelope at all. §2.1 resolves which
of these two shapes `PROJECT_SCHEMA_V1` actually versions; §2.1.1's inventory table covers all of
them, not only the five `schema.rs` names.

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

### 2.1.1 What exactly is the versioned object

Per §1.5, `StoryProject` is already a narrowed view of the real persisted surface. **`schemaVersion`
versions the complete authoritative persisted project payload — `ProjectData` (or a canonical
`ProjectDocument` that a future implementation PR may define as its equivalent, e.g. if
import/export/backup need their own explicit wrapper) — not merely the current `StoryProject`
interface or the narrower field set `coreEnvelope.ts` currently projects into the shadow-validation
envelope.** Versioning only the reduced Core-visible slice would leave every field outside it
permanently unversioned, defeating the purpose of a persisted-format version number.

This does not require Core to model every `ProjectData` field before `PROJECT_SCHEMA_V1` can exist
— §3's staged policy is exactly the mechanism that lets the version apply to the whole payload while
Core's authority over any given field grows incrementally.

**`schemaVersion` itself is deliberately not a row in the inventory below.** It is the version
discriminant of the envelope (§2.1), not a field *of* the versioned payload, so gate 1's "complete
field inventory" does not require it to appear alongside `title`/`characters`/etc. Its exact storage
location (a field on `ProjectData` itself vs. a wrapper object around it) is the implementation
detail §2.1 already leaves open — this document fixes only that it belongs to the persisted project
format and is never derived from another version. Whichever location the implementation PR chooses,
it becomes a single, consistent choice recorded in that PR, not a per-caller ambiguity: every writer
of the persisted document uses the same location, and §2.4's classification/migration rules operate
against that one location.

The inventory below is what §5's gate 1 ("complete field inventory for the admitted lifecycle")
checks against:

| Persisted field | Current TS owner | Persisted? | Core modeled? | Unknown-field class (§3) | V1 inclusion |
|---|---|---|---|---|---|
| `title`, `logline` | `ProjectData` | Yes | Yes | `MODEL_AND_VALIDATE` | In scope |
| `author` | `ProjectData` | Yes | Yes | `MODEL_AND_VALIDATE` | In scope |
| `characters`, `worlds` | `ProjectData` (via `coreBoundaryAdapter.ts`) | Yes | Yes | `MODEL_AND_VALIDATE` | In scope |
| `manuscript` | `ProjectData` | Yes | Yes | `MODEL_AND_VALIDATE` | In scope |
| `id` | `ProjectData` | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `outline`, `binderNodes`, `compileProfile`, `projectGoals`, `writingHistory` | `ProjectData` (`types.ts` `StoryProject` also declares these) | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `relationships`, `writingSessions`, `writingGoals`, `sceneBoardLayout`, `aiPreset` | `ProjectData` only (not in `types.ts` `StoryProject`) | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `persistedVersionControl` | `ProjectData`; mirrors `features/versionControl/` slice state, embedded so branches/snapshots survive reload | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `plotConnections`, `plotSubplots`, `plotTensionOverrides` | `ProjectData`; moved from the Plot Board slice so they're undo-able via redux-undo | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `storyObjects`, `objectGroups` | `ProjectData` | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `mindMaps` | `ProjectData` (viewport-only state is separate, in `mindMapUiSlice`, and is not persisted project data) | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `characterInterviews` | `ProjectData` | Yes | No | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | In scope, opaque |
| `__worldscriptLegacyProjectDirectory`, `__worldscriptLegacyAuxiliary` | Filesystem backend only (`services/fs/legacyProjectIdentity.ts`, injected onto the object and serialized to `project.json` by `services/fs/projectFsStore.ts`'s `saveProjectUnlocked`/snapshot-restore paths) — not declared on the `ProjectData` TypeScript type at all, hence the `as unknown as Record<string, unknown>` casts used to read/write them | Yes, on the filesystem/desktop backend | No | **Not** `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` — see the correction below | Excluded from portable payloads |

**Correction: this metadata is local machine-trust state, not portable opaque user data — it must
never be treated as ordinarily opaque-preserved.** `persistedLegacyAuxiliaryMetadata` (verified,
`legacyProjectIdentity.ts`) *interprets* `__worldscriptLegacyAuxiliary` as trusted routing data — a
legacy project ID, a codex flag, and a list of local binder asset IDs — and
`projectFsStore.ts`'s `registerLegacyAuxiliaryPolicy` uses it to later route, quarantine, or delete
local auxiliary assets. If this were preserved opaquely across an export/import boundary the way
ordinary `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` fields are, a carried-over or crafted value could
associate an imported project with local legacy codex/binder assets belonging to a different
project on the receiving machine — a trust confusion, not a data-loss risk. **Requirement, admitted
now:** these two fields are local machine-trust state, scoped to the filesystem backend that wrote
them; they must be **stripped at every portable boundary** (export/backup egress, §2.8's ingress for
file/backup import, snapshot restore from a file, recovery restore) and, where the local filesystem
backend still needs the routing behavior they enable, **re-derived locally** from local evidence
rather than trusted from the incoming payload — never carried through as opaque pass-through data.
Concrete stripping/re-derivation logic is `IMPLEMENTATION_REQUIRED`.

A follow-up implementation PR must re-verify this table against `ProjectData`'s exact current
fields before implementing — this table is this proposal's evidence, not a promise that the shape
hasn't changed by the time implementation starts. The filesystem-backend row above is a reminder
that "the versioned object" (§2.1.1) is backend-inclusive: a field the web/IDB backend never writes
can still be part of what a specific backend's persisted document carries, and gate 1's inventory
must be checked against each backend's actual on-disk/on-storage shape, not only the in-memory
`ProjectData` type shared across backends. The historical-filesystem-fixture requirement (§6.2)
must include a fixture carrying these two fields, proving they survive ordinary local save/load
classification and migration, and a separate fixture proving they are stripped (not carried through)
on the filesystem backend specifically.

### 2.2 First production version starts fresh at v1 — the synthetic Rust v1/v2 proof is retired

The first schema version any real WorldScript project is assigned is **`PROJECT_SCHEMA_V1`**,
defined fresh by this document against §2.1.1's full inventory — every field in that table is part
of the version-1 *format*, whether or not Core models it yet (see §3 for how unmodeled fields are
handled without being modeled). This is a deliberately new, independent number sequence from Rust's
harness-proof `1`/`2`. The existing
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

**Classification reads `schemaVersion` via a minimal raw/header parse, never via full deserialization
into the current typed schema.** If a `FUTURE`-versioned document also changed or removed a field
the current build's typed schema requires — a plausible, even likely, kind of breaking change for a
real future version to make — attempting a full structured parse first would fail *before* the
version field is ever compared, misclassifying a genuine `FUTURE` document as `MALFORMED` and
denying it the correct "this project requires a newer build" recovery path in favor of a generic
corruption message. Classification is therefore always: read the raw payload, extract `schemaVersion`
via the most permissive parse that can find that one field (tolerating a payload shape the current
typed schema would otherwise reject), classify per the table below, *then* attempt the full typed
parse only for `CURRENT` and successfully-migrated records. A raw parse that fails even to identify
a plausible `schemaVersion` field (not just "the rest of the shape doesn't match") is the only case
that classifies as `MALFORMED`.

**Accepted value grammar for `schemaVersion`.** The classification table below covers absent,
lower, equal, and higher *valid* values — it does not by itself say what happens when the field is
*present but not a valid version value* (e.g. a string `"1"`, `null`, a fractional number `1.5`, a
negative number, or a duplicate key with conflicting values in a permissive parser). The accepted
representation is a non-negative integer JSON number, matching `CURRENT_PROJECT_SCHEMA_VERSION`'s
own type; any other representation — wrong JSON type, non-integer, negative, or (where the raw
parser surfaces it) a duplicate key with conflicting values — classifies as `MALFORMED` at the raw
parse stage above, before typed parsing is ever attempted, exactly like a raw parse that cannot find
the field at all. This is not a new state, only a precise definition of which raw values the
existing `MALFORMED` classification already covers.

Classifications are disjoint by construction — each uses a strict comparison against
`CURRENT_PROJECT_SCHEMA_VERSION`, never a hardcoded specific number, so the rule set stays correct
even at the very first release where the only defined version *is* current:

```text
        ┌──────────────────────┐
        │ schemaVersion absent  │──────▶ LEGACY_UNVERSIONED
        └──────────────────────┘
        ┌────────────────────────────────────────┐
        │ schemaVersion < current                 │
        │   AND an admitted migration path exists │──────▶ SUPPORTED_OLDER
        └────────────────────────────────────────┘
        ┌────────────────────────────────────────┐
        │ schemaVersion < current                 │
        │   AND no admitted migration path exists │──────▶ UNSUPPORTED_OLDER / MIGRATION_GAP
        └────────────────────────────────────────┘
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

`UNSUPPORTED_OLDER`/`MIGRATION_GAP` is a genuinely distinct state from `FUTURE`, not a duplicate of
it: `migrate.rs`'s existing `MigrationError::NoMigrationFrom { version }` already names exactly this
condition for the harness proof (an older version with no registered migration step) — this document
adopts the same distinction for the real contract rather than collapsing "too old, no path" and "too
new, unknown" into one generic failure. At `PROJECT_SCHEMA_V1` (the first defined version) this state
is unreachable by construction — there is no older version yet to have a gap from — but the contract
must not omit it, since it is exactly the state a second real schema bump could hit if that bump's
migration step were ever incomplete or unregistered.

Per-classification admission:

```text
LEGACY_UNVERSIONED         → CLASSIFIED → MIGRATION_REQUIRED → MIGRATED_IN_MEMORY
                              → NO_LOSS_VERIFIED → DURABLE_CURRENT
SUPPORTED_OLDER             → MIGRATION_REQUIRED → (same chain as above)
UNSUPPORTED_OLDER/GAP       → RECOVERY / FAIL_CLOSED (no write authority; distinct diagnostic
                              from FUTURE — "too old, no path" vs. "too new, unknown" — but the
                              same enforcement mechanism as §2.5)
CURRENT                     → NORMAL (read/write, no migration needed)
FUTURE                      → REFUSE_WRITE_AUTHORITY (see §2.5)
MALFORMED                   → RECOVERY / FAIL_CLOSED (see the correction below — not already true
                              on the current web/IDB path)
```

`LEGACY_UNVERSIONED` and `SUPPORTED_OLDER` both resolve through the *same* explicit migration path —
never a silent in-place relabel. Preserve-first applies throughout: the original persisted form is
retained at least until `NO_LOSS_VERIFIED` succeeds and the new form is durably committed (mirrors
this codebase's existing preserve-first storage rules; see §7).

**Correction: retention "until commit" is not sufficient for a migration §2.9 classifies as
destructive.** The binding native roadmap (`docs/native/ROADMAP-QT-GPUI-DESKTOP.md` §20, "Project
format and migration policy") requires "backup before destructive migration" as a standing rule, not
a transient in-flight safeguard. A migration step that removes, renames, or otherwise cannot losslessly
reconstruct a field from its output (§2.9's bump triggers) must leave a durable, explicitly
restorable backup of the pre-migration record that survives the commit — discarding the sole
original the moment `DURABLE_CURRENT` is reached is not enough, because a migration later found
semantically wrong (a bug in the migration step itself, discovered after the fact) would otherwise
have no recovery path. A **non-destructive** migration (pure additive stamping, e.g. `LEGACY_TO_V1`
on today's shape, where the output already losslessly contains everything the source had) has no
roadmap-mandated backup obligation beyond the in-flight retention already required for
`NO_LOSS_VERIFIED` — the durable-backup requirement is specifically for the destructive case §2.9
defines. The exact retention mechanism and duration are `IMPLEMENTATION_REQUIRED`, not designed by
this document.

**Correction: `MALFORMED` recovery is not already preserve-first on the current web/IDB path.**
Verified against live source: `index.tsx`'s hydration logic calls
`normalizePersistedProjectForStore`; when it returns `undefined` (malformed project data), the
handler logs a warning and executes `delete preloadedState['project']` — Redux then initializes
with no project, `isNewUser`/default-project seeding proceeds, and the app's normal autosave path
can subsequently persist that fresh, empty project over the original record. This is destructive,
not preserve-first: the original malformed record is never quarantined, and ordinary continued use
of the app can overwrite it. The `RECOVERY / FAIL_CLOSED` label for `MALFORMED` in the table above
is therefore a requirement this contract adds, not a description of already-correct behavior — the
web/IDB path must be brought to the same non-editable, blocking recovery admission this document
already requires for `FUTURE` and `UNSUPPORTED_OLDER`/`MIGRATION_GAP` (§2.5) before an authority
switch, not merely left as-is on the assumption it already qualifies. Added as authority-switch gate
9 (§5) and decision row 13 (§9).

**`LEGACY_UNVERSIONED` gets its own explicit migration step, `LEGACY_TO_V1` — not a silent alias
into `PROJECT_SCHEMA_V1`'s dispatch point.** A normal `N → N+1` migration step (like the harness
proof's `V1ToV2`) transforms a known shape into another known shape. `LEGACY_UNVERSIONED` is
different: it has no version number to transform *from*, so treating it as if its source were
simply `PROJECT_SCHEMA_V1` — with no explicit step actually executing — would mean a legacy record
silently becomes "current" with no stamp ever written and no verification ever performed, exactly
the silent-relabel outcome this document already forbids one paragraph above. `LEGACY_TO_V1` is
therefore a real, distinct, registered migration step whose *input* is the `LEGACY_UNVERSIONED`
sentinel (not a numeric version) and whose actions are:

1. **Recognize** the legacy shape (no `schemaVersion` field present at all).
2. **Verify** the payload's field set conforms to `PROJECT_SCHEMA_V1`'s definition (§2.1.1's
   inventory) — this is a real check, not an assumption, even though today's `ProjectData` shape and
   `PROJECT_SCHEMA_V1`'s definition are the same shape by construction (§2.2).
3. **Write** `schemaVersion: 1` into the record for the first time — this is the actual state
   transition; nothing before this step has ever set the field.
4. **No-loss verify** (§4) the stamped result against the original legacy payload.
5. **Durably commit** only after step 4 succeeds, per the preserve-first chain above.

The record's *classification* for provenance/audit purposes (logging, telemetry, any future
migration-history field) remains "migrated from `LEGACY_UNVERSIONED` via `LEGACY_TO_V1`" — never
conflated with "was already `PROJECT_SCHEMA_V1`," which would misreport when the project was
actually first touched by a version-aware build. Once a second real schema version exists,
`LEGACY_TO_V1` remains the fixed entry point for any legacy record; later steps proceed normally
from `PROJECT_SCHEMA_V1` onward.

### 2.5 Future version and migration gaps: fail closed, no automatic action

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
`UNSUPPORTED_OLDER`/`MIGRATION_GAP` (§2.4) is enforced identically — the diagnostic shown to the
user differs ("this project is too old for this build's migration path" vs. "this project requires
a newer build"), but neither state ever admits write authority.

**Mechanism for disabling save/autosave, not just declaring the rule:** "no write authority" must
be enforced at the same load-time gate that already blocks the editable application shell on other
unrecoverable load failures in this codebase (the existing pattern behind `StorageErrorScreen`-style
recovery screens for corruption/decryption failures) — a `FUTURE`- or `MIGRATION_GAP`-classified
project never reaches the state that Redux's autosave listener middleware or any manual "Save"
action operates on in the first place. Concretely: the load path that would normally dispatch a
successful project-loaded action instead dispatches the corresponding recovery state and stops,
exactly as it already does for a corrupt or undecryptable project today. There is no separate
"read-only mode with save disabled" flag to forget to check on every write path; the project is
simply never admitted into the state those write paths read from. The one exception is the optional
read-only inspection view named above, which by construction reads from a value that was never
assigned into the app's normal editable project state.

**Scope limit — this guarantee only binds builds that implement it.** Today's load-admission check,
`services/fs/projectFsStore.ts`'s `looksLikeStoryProject`, is a permissive structural check: it
requires only `title`/`logline`/`manuscript`/`characters`/`worlds` and does not reject on the
presence of extra keys. Once `schemaVersion` exists (§2.1.1 lists it as an in-scope field), that
same admission check must be extended to read and enforce it — "no write authority" is only real if
the code path deciding whether to admit a project for editing actually consults the version, not
merely if this document says it should. A build that predates this contract entirely has no code
path capable of performing that check at all; no design decision in this document can retroactively
grant already-shipped code an awareness it was never given. This is an inherent limit of any
additive versioning scheme, not a gap this document can close — the practical mitigation is that a
`FUTURE`-versioned project is, by construction, one only a build implementing this contract could
have produced in the first place, so the exposure window is bounded by how many older, no-longer-
updated installs remain in use, not open-ended.

### 2.6 Downgrade: never automatic

A newer schema opened by an older client never auto-downgrades. If an explicit "export for an older
WorldScript Studio version" feature is ever wanted, it is a distinct, explicit, separately-scoped
export action that names any features/fields it cannot represent — never part of ordinary
open/save.

### 2.7 Pre-contract downgrade safety: a migrated record must not be re-superseded by a stale copy

§2.5's scope-limit caveat establishes that a genuinely pre-contract build (one with no code path
capable of reading `schemaVersion` at all) cannot itself be made to fail closed. That gap has a
second half this document must also close: once a project *has* been migrated to a schema-aware
canonical representation and durably committed, an old build that still holds — and can still
mutate — its own legacy-shaped copy of that same project must never be able to have that mutation
silently supersede the already-migrated canonical record. Without an explicit rule here, a plausible
sequence is: project migrates to `PROJECT_SCHEMA_V1` → an old, still-installed build later opens and
resaves its own untouched legacy copy (it never knew a migration happened) → that resave is mistaken
for the current authoritative record, silently reverting the project past a migration point that
already succeeded.

**Required invariant:** once the schema-aware representation for a given project becomes
authoritative, any surviving pre-contract-shaped representation of that same project is
non-authoritative and cannot supersede the schema-aware canonical generation through ordinary
save/autosave. An old build may still mutate its own legacy-shaped copy — this document does not
propose preventing that, since a pre-contract build cannot be changed retroactively (§2.5) — but the
schema-aware load/admission path must never treat that mutated legacy copy as a valid update to the
already-migrated canonical record. At most, a later-observed legacy-shaped write for an
already-migrated project is surfaced as an explicit recovery/import candidate requiring user
action, never an automatic authority supersession.

The exact storage mechanism that satisfies this invariant (a distinct canonical location or root
shape the old `looksLikeStoryProject`-style check would not recognize; a generation/namespace
authority in IDB that a legacy write cannot address; or another equivalent) is an implementation
detail for the follow-up PR, matching how §2.1 leaves the exact envelope representation
unspecified — what this document fixes is that *some* mechanism satisfying the invariant above must
exist before an authority switch, and "the old file format still happens to be readable" is not
sufficient on its own.

### 2.8 Universal ingress admission: every path in, not just the primary load path

**Contract invariant, admitted now; concrete code changes are `IMPLEMENTATION_REQUIRED`.** §2.4's
raw/version classification and this contract's schema admission must run before typed narrowing or
Redux/editable-state admission — on *every* ingress capable of producing authoritative editable
project state, not only the primary stored-project load path discussed in §2.4/§2.5. A version gate
that only the main load path honors is not a real gate; any other ingress is a bypass of everything
this document establishes. Named examples this applies to (illustrative, not exhaustive — any
current or future ingress producing editable project state is in scope by the general rule, whether
or not it is named here):

- Stored-project load (primary IDB/filesystem hydration — already covered in detail above).
- Filesystem load (`services/fs/projectFsStore.ts` and equivalents).
- IDB load.
- File/backup import (e.g. `services/projectImportSchema.ts`'s `parseImportedProjectJson`).
- Snapshot restore (e.g. `IdbSnapshotStore` / `restoreSnapshotThunk`).
- Recovery restore (any explicit user-triggered restore-from-backup path).
- Future native/Qt project open.

This document does not redesign any of these individual code paths — that is implementation work
for the follow-up PR(s), tracked as `IMPLEMENTATION_REQUIRED` per-path, not `ADMITTED_IMPLEMENTED`
by this document. What is admitted here is the invariant itself: no ingress path is exempt from
classification merely because it predates this contract or is a narrower/secondary path relative to
the primary load.

**Egress must match, or ingress admission alone does not prevent data loss.** An ingress-only gate
is not sufficient by itself: if a project's export/backup path serializes a narrowed, typed
projection rather than the canonical raw payload (§3.1), any opaque/out-of-scope field this contract
requires ingress to preserve is silently absent from that export — and re-importing it then
classifies as `LEGACY_UNVERSIONED` (or worse, appears to round-trip cleanly) with those fields
already gone, defeating the no-loss guarantee (§4) this document exists to establish. Verified
against live source: `hooks/useSettingsView.ts`'s `handleExport`, `BackupQuickActionsCard.tsx`'s
`handleExport`, and `services/libraryBackupService.ts`'s `collectLibraryBackupPayload` (via
`storageService.loadProject` returning the narrowed `StoryProject` type) all currently serialize the
typed/narrowed projection, not a canonical raw payload. Snapshot creation
(`storageService.saveSnapshot`, `IdbSnapshotStore.createSnapshot`) is a distinct fourth egress named
here explicitly, since it is a separate call path from the three above and must not be assumed
covered by them. **Requirement, admitted now:** every project export/backup/snapshot egress must
serialize the same canonical raw payload this contract defines for ingress, including its
opaque/out-of-scope fields — never only the typed projection. Concrete code changes to these and any
other egress path are `IMPLEMENTATION_REQUIRED`, matching the per-path status of the ingress list
above.

### 2.9 What requires a schema version bump

**Design decision, admitted now.** This contract defines who writes `schemaVersion` and how
versions classify, but a persisted-format change is only safe if this contract also defines *when*
the number must advance. A version bump (and the corresponding migration/admission review, §2.4) is
mandatory whenever a change could cause an older reader/writer to misinterpret or lose data. At
minimum, all of the following require a bump:

- Adding a new **required** (non-optional) field.
- Removing or renaming any existing field.
- Changing an existing field's type.
- Any semantic or invariant change incompatible with how an older build interprets the same shape
  (e.g. changing what a field's absence means).
- **Any** new value added to a closed discriminant/enum under §3's `REJECT_UNKNOWN` policy — including
  a purely additive one. **Correction:** an earlier draft of this rule exempted purely-additive enum
  changes from the bump requirement; that was wrong, because `REJECT_UNKNOWN` fields are matched
  against `CURRENT_PROJECT_SCHEMA_VERSION`, not against their own independent version — if the
  document's `schemaVersion` does not advance, an older build classifies the document as `CURRENT`
  and attempts typed parsing, where it hits the new value and must apply `REJECT_UNKNOWN` outside the
  clean `FUTURE`/`MIGRATION_GAP` recovery path (§2.5) the classification stage would otherwise route
  it through — an ad-hoc failure, not the intended fail-closed recovery. A bump is required for every
  new value on a `REJECT_UNKNOWN` discriminant, with no purely-additive exception; a field that
  genuinely needs additive-without-bump tolerance must first be redefined under an explicitly open
  compatibility policy (`PRESERVE_OPAQUE`'s sibling-field tolerance, §3's second row), not left under
  `REJECT_UNKNOWN` with an implicit carve-out.
- Any change to identity or declared-order semantics (§6.1's invariants).
- Any other persisted-format change an older reader/writer could misinterpret or silently lose.

Changes that do **not** require a bump: a new **optional** field routed through §3's
`OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` or `PRESERVE_OPAQUE` policy without altering the meaning of
any existing field — the staged unknown-field policy (§3) is exactly what makes this kind of change
safe without a version bump.

This classification is a **permanent release invariant**, not a one-time decision made by this
document and then forgotten: every future project-format change must be evaluated against this list
before shipping, and that evaluation — not only its outcome — belongs wherever this contract's
decisions are recorded (e.g. a changelog entry, or an update to this document).

## 3. Decision 2 — Unknown-field policy is staged by field class, not one global choice

A single global policy is wrong here: the right answer depends on what kind of field is unknown.

| Field class | Policy | Why |
|---|---|---|
| Persisted data not yet modeled by Core at all (today: every `ProjectData` field beyond `title`/`logline`/`author`/`characters`/`worlds`/`manuscript` — see §2.1.1's full inventory) | `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` | Core makes no claim about these fields' meaning; it must still never cause them to disappear from the persisted document. |
| Additive unknown fields inside an object Core *does* claim authority over (e.g. a future field added to `Character`) | `PRESERVE_OPAQUE` | Core understands the object's shape but not every field on it yet; the object round-trips losslessly while the unknown sub-fields wait to be modeled. |
| An unknown value for a closed, semantically load-bearing discriminant/enum Core must interpret to act correctly | `REJECT_UNKNOWN` | Silently passing through an unrecognized enum value risks Core acting on a wrong interpretation of it — failing closed is safer than opaque pass-through here. |
| Fields fully modeled and owned by Core today (`title`, `logline`, `characters[].id`, etc.) | `MODEL_AND_VALIDATE` | Already validated per-field; no ambiguity to resolve. |

**Correction: "already validated" understates a real, verified gap.** For at least two fields
already treated as modeled, TypeScript's and Rust's validation domains genuinely differ today —
`services/projectImportSchema.ts` accepts any numeric `wordCount` while
`crates/worldscript-project/src/schema.rs` rejects negative/fractional values as a `u32`, and a
similar TS-looser/Rust-stricter mismatch exists elsewhere. "Requiring eventual TS/Rust parity" (gate
4, §5) does not by itself say *which* domain is authoritative, and naively tightening TypeScript to
match Rust's stricter domain could make an existing, already-saved, legitimately-accepted project
newly unreadable — exactly the silent-loss failure mode this document exists to prevent, just
via validation rather than a dropped field. **Requirement, admitted now:** before any field's
classification changes from unvalidated pass-through to `MODEL_AND_VALIDATE` authority, the chosen
validation domain must be proven compatible with (a strict superset of, or an explicitly reconciled
narrowing of) every value TypeScript's own shipped validation has already accepted and legitimately
persisted for that field — never assumed compatible by declaration. Reconciling a current TS/Rust
domain mismatch for an already-modeled field is `IMPLEMENTATION_REQUIRED`, per field, and must be
exercised against real historical values in the parity fixtures (§6.2) before that field's
`MODEL_AND_VALIDATE` classification is treated as switch-ready (§5's gates).
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
        ├── retained as the canonical raw JSON value (the lossless carrier — see §4 for
        │   exactly what "lossless" does and does not require)
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

### 3.2 Write-back invariant: how a known-field edit is merged without corrupting the raw carrier

A raw-carrier-plus-typed-projection split (§3.1) is only safe if writing back a change to a *known*
field has a defined, non-destructive mechanism. The wrong mechanism — "serialize the typed
projection and use that as the new raw payload" — silently deletes every opaque field the
projection never carried in the first place, reintroducing exactly the failure §1.4 describes. The
required mechanism instead merges a change into the existing raw payload without touching the paths
Core doesn't own:

```text
raw source generation R
        │
        ▼
typed projection P derived from R (§3.1)
        │
        ▼
Core modifies only paths P admits owning
        │
        ▼
the modified paths are merged/overlaid into a copy of the *same* raw payload R
        │        (every unowned path in R is carried through unchanged — this is an overlay
        │         onto R, never a re-serialization of P as if it were the whole document)
        ▼
verify the merge, two-sided, not opaque-paths-only:
        │  (a) unowned paths — semantic no-loss (§4) against the pre-merge raw payload
        │  (b) owned paths — re-project the merged payload and confirm every owned path
        │      equals the value Core intended to write; an overlay bug that omits an edit
        │      or writes to the wrong path must fail this check, not silently commit the
        │      old or misplaced value
        ▼
atomically, as one fenced operation (compare-and-swap on the generation, or an exclusive
writer lease held across both steps — never two separate steps with a window between them):
        │
        ├── generation still matches what P was derived from → commit
        │
        └── generation no longer matches (another writer committed first) → FAIL CLOSED,
            discard this merge entirely — a check that passed a moment ago is not
            sufficient license to commit a moment later; the validation and the commit
            must be the same indivisible operation, not a check-then-act pair with a gap
            another writer can land in
        ▼
durable commit
```

The generation/source-identity check is deliberately the same shape this codebase's own preserve-
first storage work already uses elsewhere for detecting a stale write target — it is not invented
new here, only applied to this specific merge, but it must be *implemented* as a single atomic
operation (whatever primitive the target storage backend provides for this) rather than as two
separate steps, or the check does not actually prevent the race it exists to prevent.

**The fence must be safe across processes, not only within one runtime.** An in-process exclusive
lock (a mutex, an in-memory flag) only serializes writers inside the same process — it does nothing
when a second process can write the same project (two instances of the same desktop build, or a
future Tauri instance and a Qt instance open on the same project file). For a single-process/
single-tab target (e.g. today's web/IDB path), an IndexedDB transaction that reads-checks-writes
without yielding is sufficient, since IndexedDB itself serializes transactions per origin. For any
target where more than one OS process can hold a writer role, the fence must be a mechanism every
such writer actually observes — a filesystem-level compare-and-swap primitive, an OS-level exclusive
lease/lock file every writer opens and honors, or an equivalent cross-process primitive — not an
in-process-only lock presented as if it were sufficient. Which primitive applies to which target is
`IMPLEMENTATION_REQUIRED`; what this document fixes is that the primitive must actually span every
process capable of writing that target, not just the calling runtime. This connects forward to any
future multi-writer/generation-authority work (see the project's own writer-ownership backlog); this
document does not implement that work, only ensures the raw-carrier merge step has a defined,
fail-closed answer for "what if the source moved under me" — from another writer in the same process
or a different one — rather than leaving it undefined until an implementation PR has to invent one
under time pressure.

**Identity-bearing collections merge by stable entity ID, never by position.** `characters`,
`worlds`, and any equivalent identity-bearing collection are merged during the overlay step (above)
by stable entity ID — never by array index or object-enumeration position. A raw payload using the
Redux `EntityState` shape (keyed under `entities[id]`) and a Core projection using a normalized
array (§6.1) must resolve to the *same* entity whenever they share an ID, regardless of any position
or ordering difference between the two representations at merge time. Opaque sibling fields on an
entity stay attached to that entity's identity throughout the merge — never reattached to whatever
value happens to occupy the same array index or iteration position in the other representation.
Declared order (§6.1) is a separate, already-covered invariant; merging by ID does not change how
order is determined or preserved. The concrete merge implementation is `IMPLEMENTATION_REQUIRED`,
not designed by this document — this fixes only the identity-vs-position invariant it must satisfy.

## 4. No-loss round-trip — precise definition

"No loss" means, precisely:

- **Semantic JSON equality**, not byte-for-byte identity — key order, whitespace, escape spelling,
  and numeric-literal formatting are not user data and are not part of this guarantee.
- **Exact semantic preservation of every opaque/unmodeled value** — same JSON type, same value,
  same nested structure, same array order, same object membership. "Verbatim" is deliberately not
  used here: a parsed-and-reserialized JSON value is allowed to differ in whitespace/key-order/
  escape representation while still satisfying this guarantee, and calling that "verbatim" would
  contradict the semantic-equality standard stated above. **"Same value" includes exact numeric
  precision, which is not automatic for JSON numbers between TS and Rust:** JavaScript's `JSON.parse`
  rounds an integer beyond `Number.MAX_SAFE_INTEGER` (e.g. `9007199254740993`), while Rust's
  `serde_json::Value` retains a `u64` of the same magnitude exactly — an opaque field holding such a
  value could silently change on an ordinary TS load/save even though this guarantee requires it not
  to. **Requirement, admitted now:** the raw-carrier mechanism (§3.1) must not lose integer precision
  for any opaque/unmodeled numeric value, for any value either implementation may encounter — the
  exact lossless representation (e.g. a bigint-aware parse path, or preserving large numeric literals
  as strings internally rather than as parsed `number`s) is `IMPLEMENTATION_REQUIRED`, verified by a
  boundary fixture at and beyond `Number.MAX_SAFE_INTEGER`.
- **Array order preservation** for every ordered collection.
- **Stable ID preservation**, exactly (already proven for `characters`/`worlds` by
  `coreBoundaryAdapter.ts` — see §6.1).
- **No missing fields** relative to the source, and **no invented fields**, except:
  - a field an explicitly admitted migration step introduces (mirroring `revision_note`'s own
    honest doc comment about why it exists), and
  - a field an explicitly admitted migration step's own manifest declares as removed, renamed, or
    replaced — §2.9 permits a version bump specifically for this case, so a no-loss check that
    forbids all missing fields unconditionally would make any admitted removal/rename impossible to
    ever ship. The exemption applies only to paths the migration's manifest names as deliberately
    consumed; every path the manifest does not name must still satisfy semantic preservation
    unchanged. A migration step with no declared manifest (e.g. `LEGACY_TO_V1`, which is purely
    additive) has no removed/renamed paths and so this exemption is vacuous for it.
    **Correction: the exemption alone is not sufficient for a rename/replacement — it must not
    become a way to silently launder a dropped value.** As stated, a manifest could name `oldField`
    as consumed and simply omit or default `newField`, and this exemption would let that pass the
    no-loss check even though the value was lost, not transformed — and TS/Rust parity (gate 4) would
    not catch it either if both implementations make the same mistake. **Requirement, admitted now:**
    a manifest entry for a rename/replacement must declare an explicit source-path → destination-path
    mapping, and the no-loss/migration-output check must verify the destination path actually
    contains the semantically-transformed source value — not merely that the source path is absent
    and some value exists at the destination. A pure removal (no replacement destination) has no such
    mapping to verify and is unaffected by this requirement.

## 5. Authority-switch admission gates

Before the current `OBSERVATION_ONLY` shadow comparison may become any production decision/write
authority, all of the following are required. None is confirmed satisfied *for an authority switch*
by this document — gate 7 already has structural evidence in today's code, but "structurally
supports it" and "verified sufficient for an actual switch" are different claims, and only the
latter satisfies this list:

1. Complete field inventory for the admitted lifecycle — every `ProjectData` field in §2.1.1's table
   is either modeled, or explicitly and deliberately routed through §3's out-of-scope/opaque
   handling, never merely "not yet gotten to." (Not `StoryProject` alone — see §1.5.)
2. §2's version classification implemented and exercised against real historical projects, not only
   the synthetic harness shapes — including a real `UNSUPPORTED_OLDER`/`MIGRATION_GAP` test case
   once a second real schema version exists to create one.
3. No-loss round-trip proof (§4) for every *admitted or migrated* fixture class in §6.2, including
   the write-back merge invariant (§3.2) under a concurrent-generation-change scenario. This does
   **not** apply to fixture classes the contract intentionally refuses (`FUTURE`,
   `UNSUPPORTED_OLDER`/`MIGRATION_GAP`, `MALFORMED`) — see §6.2's split for what those require
   instead (source preserved unchanged, zero durable writes, zero editable-state admission; never a
   semantic round-trip, since nothing is meant to be admitted or transformed).
4. TS/Rust parity, kept permanently — not scoped to a transition window, and not limited to
   accept/reject agreement. The React/PWA product and any native Core/Qt consumer are both
   permanent, coexisting readers/writers of the same renderer-independent format (§7's Qt
   relationship), not a temporary migration pair; a later schema change shipping in one without the
   other is a parity break at any point in this project's life, not only during an initial cutover.
   **Accept/reject agreement alone is not sufficient**: §4 permits a migration to introduce or
   consume declared fields, so two implementations could both legitimately accept the same older
   document yet apply different migration defaults or normalizations and produce semantically
   different current documents while still "agreeing" on accept/reject. The permanent cross-renderer
   fixtures (§6.2) must additionally prove semantic equality (§4) of each migration's *resulting*
   canonical payload between TS and Rust, not only that both accepted the same input.
5. Rollback/fallback: the TS-authoritative path can still read whatever Rust most recently wrote.
6. Representative historical fixtures — real project shapes predating this contract, not only
   synthetic ones already shaped to match it.
7. No Redux-specific types leaking into Core. `coreBoundaryAdapter.ts` already provides structural
   evidence for this today (§6.1) — re-verify it still holds, with fresh evidence against the
   switch-time code, rather than treating today's evidence as sufficient proof on its own.
8. Pre-contract downgrade safety (§2.7): a concrete mechanism exists such that a mutated
   pre-contract-shaped copy of an already-migrated project cannot supersede the schema-aware
   canonical record through ordinary save/autosave.
9. `MALFORMED` recovery is genuinely preserve-first on every backend (§2.4's correction) — the
   current web/IDB path's actual behavior (delete the project key, boot a blank project, allow
   autosave to overwrite the original record) is replaced with the same non-editable, blocking
   recovery admission already required for `FUTURE`/`MIGRATION_GAP` (§2.5), before an authority
   switch, not assumed already true.

## 6. Fixtures and existing invariant coverage

### 6.1 Entity-state invariants — already satisfied, no change proposed

`coreBoundaryAdapter.ts`'s `entityStateToCoreArray`/`coreArrayToEntityState` and
`tests/unit/features/project/coreBoundaryAdapter.test.ts` already fail closed on duplicate IDs,
missing `ids`/entity correspondence, and orphan entities, and already preserve declared order and
stable IDs exactly. No change proposed here.

### 6.2 Fixture classes required for §5 gate 3's no-loss proof

None of these exist yet; a follow-up implementation PR adds them. Split into two groups by what
each fixture class actually proves — a semantic round-trip is meaningful only for fixtures the
contract admits or migrates; for fixtures the contract intentionally *refuses*, the correct proof is
that nothing was admitted, transformed, or written at all.

**Group A — admitted or migrated fixtures (§4's semantic no-loss round-trip applies):**

- A current, fully-populated project exercising every field in §2.1.1's inventory.
- A representative historical project predating this contract (`LEGACY_UNVERSIONED`) — proves
  `LEGACY_TO_V1` (§2.4).
- A project at each `SUPPORTED_OLDER` version once more than one exists.
- Extra unknown fields at the top level of the payload, and nested inside an already-Core-owned
  object (§3's `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` and `PRESERVE_OPAQUE` rows respectively).
- Array and `EntityState` forms of `characters`/`worlds` (existing coverage — §6.1 — re-run against
  the versioned envelope), including the identity-by-ID merge invariant (§3.2).
- A large, representative project (performance/scale sanity, not just correctness).
- The write-back merge (§3.2) under an unchanged source generation, proving the ordinary commit
  path succeeds.
- The write-back merge (§3.2) where the overlay implementation is deliberately made to omit an edit
  or write it to the wrong path, proving the owned-path re-projection check catches it rather than
  letting the stale/misplaced value commit.
- An export-to-import round trip through each backup/export egress named in §2.8's egress
  requirement, proving opaque/out-of-scope fields survive a full backup-and-restore cycle, not only
  ordinary save/load.
- A snapshot create-then-restore round trip (`storageService.saveSnapshot`/`IdbSnapshotStore.
  createSnapshot`, `restoreSnapshotThunk`) — verified live to differ from the three §2.8 egress call
  sites in what it currently receives, so it is named here explicitly rather than assumed covered by
  the export/backup fixture above. Snapshot creation is added to §2.8's canonical-payload egress
  requirement alongside export/backup.
- A full round-trip no-loss comparison (§4) across every fixture in this group.

**Group B — refused fixtures (no round-trip; proof is preserve-and-refuse instead):**

- A project in `UNSUPPORTED_OLDER`/`MIGRATION_GAP` (§2.4) — a version older than current with no
  registered migration step.
- A project at a `FUTURE` version (§2.5).
- A `FUTURE`-versioned project whose shape *also* breaks the current typed schema (missing/renamed
  field the current build requires) — must still classify as `FUTURE` via the raw/header parse
  (§2.4), never misclassify as `MALFORMED`.
- An unknown value for a closed discriminant/enum Core owns (§3's `REJECT_UNKNOWN` row).
- A `MALFORMED`/genuinely unparseable project (§2.4's correction — proves the new non-editable,
  blocking recovery admission actually replaces the current destructive delete-and-reset behavior,
  on the web/IDB backend specifically).
- The write-back merge (§3.2) under a source generation injected to change between validation and
  the intended commit point, proving the atomic check-and-commit actually fails closed rather than
  merely detecting the race too late to matter. **This fixture is a write-conflict on an already-
  admitted project, not a refused input document** — the project reaching this fixture necessarily
  went through Group A admission first, so "zero editable-state admission" below does not apply to
  it (that admission already legitimately happened before the conflict arose). The required proof for
  this specific fixture is instead: the losing writer's merge produces zero durable commit, and the
  generation that actually won the fence remains the durable record afterward — the write-back
  invariant (§3.2) fails closed, it does not corrupt or silently discard the winner.

For every *other* fixture in Group B — i.e. every genuinely refused input document (`FUTURE`,
`UNSUPPORTED_OLDER`/`MIGRATION_GAP`, `REJECT_UNKNOWN` discriminant values, `MALFORMED`) — the
required proof is: the source is preserved byte-for-byte unchanged, zero durable writes occur, and
zero editable-state admission occurs (no Redux/UI state is ever populated from it) — never a
semantic round-trip, since nothing about these inputs is supposed to be admitted or transformed in
the first place.

Golden fixtures should exist in both TS and Rust wherever transition parity matters, matching
issue `#553`'s own fixture/evidence section.

## 7. Relationship to preserve-first, R-15, and Qt

- **Preserve-first:** §2.4's migration chain (retain original until `NO_LOSS_VERIFIED` and durable
  commit, plus a durable post-commit backup for any migration §2.9 classifies as destructive) is
  this codebase's existing preserve-first storage principle, and the native roadmap's "backup before
  destructive migration" rule (`docs/native/ROADMAP-QT-GPUI-DESKTOP.md` §20), applied to
  project-schema migration specifically — not a new principle invented here.
- **R-15 (#445):** a distinct security/durability contract for the encrypted-record envelope, key
  management, and migration — this document's `schemaVersion` is not R-15's envelope version (§1.3)
  and this document does not admit, implement, or modify any part of R-15's S5 contracts.
- **ADR-0008 (local-first Y.Doc):** this document governs the *current* authority model — TypeScript/
  Redux's `ProjectData` is the persisted source of truth, and `enableLocalFirstSync` (default off)
  keeps the Y.Doc projection a non-authoritative shadow (`services/localFirst/docPersistence.ts`
  persists it as a separate Yjs update log, not through `StorageBackend`). ADR-0008 is accepted in
  principle but its one-way authority flip has not occurred and is not gated by anything in this
  document. **This admission does not extend schema-version admission, migration, or opaque-field
  guarantees to the Y.Doc/CRDT update-log format** — if and when ADR-0008's flip is scheduled, that
  flip requires its own compatibility-contract review (covering Y.Doc replay, remote CRDT updates,
  and fixtures for that format) before this contract's authority-switch gates (§5) could be read as
  covering it. Explicitly out of scope, not implicitly inherited.
- **Qt:** any future Qt-side project consumer must read the same canonical raw payload + typed
  projection this document defines, never redefine its own project-schema rules — matching issue
  #553's own instruction that "Qt must consume this admitted Core boundary; QML must not recreate
  its own project schema rules."

## 8. Non-goals

- Any change to current write authority — TypeScript remains sole authority; Rust's shadow
  comparison remains `OBSERVATION_ONLY`.
- R-15 (#445)'s encrypted-storage envelope, key management, or migration contract.
- Modeling every currently-unmodeled `ProjectData` field in Rust immediately — §3 deliberately
  defers that to whenever each field actually graduates to Core-owned authority.
- Moving Redux reducers into Rust.
- Redesigning import UX.
- Any Qt vertical-slice work.
- Implementing any part of §2–§5 — this document proposes the contract; a follow-up PR implements
  it, with its own fixture/evidence matrix, exact-head CI, and CodeQL gate.

## 9. Maintainer decision record

Each row below is a single decision this document makes. **All 19 rows are confirmed — this
document is admitted**, per the status line above. The rows are kept as an itemized record of what
was decided, not as an open confirm/amend/reject checklist.

| # | Decision | Status |
|---|---|---|
| 1 | Persisted `schemaVersion` belongs to the project document itself, distinct from app/IndexedDB/contract/R-15 versions (§1.3, §2.1) | ✅ confirmed |
| 2 | **The versioned object is `ProjectData` (the full persisted/Redux surface), not `StoryProject` or the narrower shadow-envelope projection** (§2.1.1) | ✅ confirmed |
| 3 | First production version is a fresh `PROJECT_SCHEMA_V1`, defined against §2.1.1's full field inventory; Rust's existing harness `1`/`2` is not canonicalized as real project history (§2.2) | ✅ confirmed |
| 4 | Absent version → `LEGACY_UNVERSIONED`, never silently treated as current (§2.3) | ✅ confirmed |
| 5 | Version classification is disjoint via strict comparison, with a distinct `UNSUPPORTED_OLDER`/`MIGRATION_GAP` state (mirroring `migrate.rs`'s existing `NoMigrationFrom`) separate from `FUTURE` (§2.4) | ✅ confirmed |
| 6 | Future version and migration gaps both fail closed — no write authority, no auto-migration, no auto-downgrade (§2.5, §2.6) | ✅ confirmed |
| 7 | Unknown-field policy is staged by field class per §3's table, not one global policy | ✅ confirmed |
| 8 | Mechanism: raw canonical payload as lossless carrier + typed Core projection, evaluated per-struct rather than blanket `#[serde(flatten)]` (§3.1) | ✅ confirmed |
| 9 | Write-back merge invariant: known-field edits overlay onto the raw carrier, never re-serialize the typed projection as the whole document; fail closed on a source-generation change since the projection was derived (§3.2) | ✅ confirmed |
| 10 | No-loss definition per §4 (semantic equality, not byte-identical; "verbatim" is not used) | ✅ confirmed |
| 11 | `LEGACY_UNVERSIONED` migrates via its own explicit, registered `LEGACY_TO_V1` step (recognize → verify → stamp → no-loss-verify → commit) — never an implicit alias into `PROJECT_SCHEMA_V1`'s dispatch point with no step actually executing | ✅ confirmed |
| 12 | Pre-contract downgrade safety (§2.7): once migrated, a project's schema-aware canonical record can never be superseded by a mutated pre-contract-shaped copy through ordinary save/autosave; the exact storage mechanism is left to the implementation PR, but the invariant itself is fixed here | ✅ confirmed |
| 13 | `MALFORMED` recovery must be brought to genuine preserve-first behavior on the web/IDB backend (§2.4's correction) — the current `index.tsx` path (delete the project key, boot blank, allow autosave to overwrite the original) is not already-correct behavior this contract can assume | ✅ confirmed |
| 14 | Version classification reads `schemaVersion` via a minimal raw/header parse before any full typed deserialization, so a `FUTURE` document with a breaking shape change still classifies as `FUTURE`, never `MALFORMED` (§2.4) | ✅ confirmed |
| 15 | Write-back merge verification is two-sided: unowned paths checked for no-loss *and* owned paths re-projected and confirmed to equal the intended edit — not opaque-paths-only (§3.2) | ✅ confirmed |
| 16 | Generation revalidation and commit are one atomic, fenced operation (compare-and-swap or an exclusive lease spanning both) — never a check-then-act pair with a window another writer can land in (§3.2) | ✅ confirmed |
| 17 | Universal ingress admission (§2.8): classification and schema admission apply to every ingress producing editable project state — not only the primary load path — naming stored-project load, filesystem load, IDB load, file/backup import, snapshot restore, recovery restore, and future native/Qt open as examples; concrete per-path changes are `IMPLEMENTATION_REQUIRED` | ✅ confirmed |
| 18 | Identity-bearing collections (`characters`, `worlds`, equivalents) merge by stable entity ID, never array index or enumeration position (§3.2); concrete merge implementation is `IMPLEMENTATION_REQUIRED` | ✅ confirmed |
| 19 | Schema version-bump policy (§2.9): required-field additions, removals/renames, type changes, incompatible semantic/invariant changes, non-additive closed-discriminant changes, and identity/order semantic changes all require a bump; this classification is a permanent release invariant, evaluated for every future format change | ✅ confirmed |

**Implementation status of concrete mechanics named in this document** (tracked here so "admitted as
a contract invariant" is never mistaken for "already implemented"): the specific code changes for
universal ingress admission (§2.8 — stored-project load, filesystem load, IDB load, file/backup
import, snapshot restore, recovery restore, future native/Qt open), identity-bearing collection
merge (§3.2), the write-back overlay mechanism (§3.1/§3.2), `LEGACY_TO_V1` (§2.4), the pre-contract
downgrade barrier (§2.7), and the `MALFORMED` recovery fix (§2.4's correction) are all
`IMPLEMENTATION_REQUIRED` — none exist in code today. This document admits the invariants they must
satisfy; it does not implement any of them.

**Post-signoff refinements (do not reopen rows 1–19):** after maintainer sign-off on this document's
decisions, automatic review surfaced six concrete gaps in how those already-approved decisions were
specified — each verified against live source or the binding native roadmap before being addressed,
and each closing a loophole in an already-admitted invariant rather than introducing a new decision:
a cross-process-unsafe example in the write-back fence mechanism (row 16, §3.2); TS/Rust parity
scoped to accept/reject only, missing migration-output equality (row 4's gate, §5); the no-loss
definition (row 10, §4) not accounting for §2.9's already-admitted field-removal/rename bump case;
the Group B refusal blanket (§6.2) not accounting for the concurrent-write fixture starting from an
already-admitted project; no egress counterpart to universal ingress admission (row 17, §2.8),
verified against three live export/backup call sites; and migration backup retention scoped only to
"until commit," short of the binding roadmap's "backup before destructive migration" rule (§2.4,
§7). None of these required a new product/security/legal decision or contradicted any of rows 1–19
as approved; each is recorded inline at its section rather than as a new numbered row.

**Second wave of post-signoff refinements:** five further findings landed on the admission commit
itself, again verified before being addressed: stale proposal-stage confirm/amend/reject wording
left in this section's own intro after admission (fixed above); §2.1.1's field inventory not stating
that `schemaVersion` itself is deliberately excluded from that table (§2.1.1); the version
classification table not defining the accepted value grammar for a present-but-invalid
`schemaVersion` (§2.4); a genuine gap verified against live source — the filesystem backend
(`services/fs/projectFsStore.ts`, `legacyProjectIdentity.ts`) persists two backend-specific fields
(`__worldscriptLegacyProjectDirectory`, `__worldscriptLegacyAuxiliary`) absent from `ProjectData`'s
declared type, now added to §2.1.1's inventory; and an explicit scope boundary against ADR-0008's
accepted-but-not-yet-flipped local-first Y.Doc authority model (§7), which this document does not
extend to. As with the first wave, none required a new product/security/legal decision or
contradicted rows 1–19.

**Third wave of post-signoff refinements, and the last absorbed into this document:** six further
findings landed on the second-wave commit, verified before being addressed: the newly-added
filesystem-metadata inventory row wrongly implied ordinary opaque preservation across portable
boundaries for local machine-trust data (`__worldscriptLegacyProjectDirectory`/
`__worldscriptLegacyAuxiliary`, verified to drive local asset routing/quarantine decisions) — now
corrected to require stripping/re-derivation at portable boundaries instead; the bump-policy
exemption for purely-additive closed-enum values contradicted `REJECT_UNKNOWN`'s own fail-closed
intent — removed; `MODEL_AND_VALIDATE`'s "already validated" claim did not hold for at least one
verified field (`wordCount`) where TS's and Rust's validation domains actually differ today — added
a requirement that tightening validation must never retroactively invalidate existing persisted
values; the no-loss definition did not address JS/Rust large-integer precision divergence for opaque
numeric values — added an explicit lossless-numeric requirement; the migration removal/rename
exemption (from wave one) did not require verifying a renamed value actually landed at its
declared destination — added that requirement; and the egress requirement (from wave one) omitted
snapshot creation as a fourth call site distinct from the three named exports — added. None required
a new product/security/legal decision or contradicted rows 1–19; this document is now closed to
further design-cascade rounds — any further finding is dispositioned as `IMPLEMENTATION_REQUIRED` or
a stated non-issue in its review thread, not absorbed as another document revision.

All 19 rows above are confirmed. This document's status line reflects `ADMITTED = YES` and
`CORE-MIGRATION-LEDGER.md` row 9 is updated to reflect it, per issue `#553`'s own acceptance
criterion. Implementation begins only in a separate, subsequent PR.
