/**
 * Production persisted-project schema-version classification (issue #553,
 * docs/native/PROJECT-CORE-COMPATIBILITY-CONTRACT.md section 2 — admitted, ADMITTED = YES).
 *
 * Distinct from `coreEnvelope.ts`'s `CORE_PROJECT_SCHEMA_VERSION`, which versions only the
 * synthetic Wave 2 shadow-validation envelope, not the real persisted `ProjectData` document.
 * This module implements the raw/header classification only (contract section 2.4) — it does not
 * implement the typed `ProjectData` graduated validation (`MODEL_AND_VALIDATE`, contract section
 * 3) or wire into any ingress path (contract section 2.8, Slice B).
 */

/** First production version. Fresh; not derived from the Rust harness's synthetic v1/v2 proof. */
export const PROJECT_SCHEMA_V1 = 1 as const;

/** The version this build currently writes and treats as non-legacy, up to date. */
export const CURRENT_PROJECT_SCHEMA_VERSION: number = PROJECT_SCHEMA_V1;

/**
 * Versions with a registered migration step into the next version, keyed by source version.
 * Empty today: `PROJECT_SCHEMA_V1` is the only defined version, so there is no real `N -> N+1`
 * step yet (only the `LEGACY_UNVERSIONED -> PROJECT_SCHEMA_V1` step, `LEGACY_TO_V1`, which is not
 * keyed by a source *version* at all — see `classifyRawProjectVersion`). Add a source-version
 * entry here the day a second real schema version is defined and its migration is registered.
 */
const SUPPORTED_OLDER_SOURCE_VERSIONS: ReadonlySet<number> = new Set<number>();

export type ProjectVersionClassification =
  | 'LEGACY_UNVERSIONED'
  | 'SUPPORTED_OLDER'
  | 'UNSUPPORTED_OLDER'
  | 'CURRENT'
  | 'FUTURE'
  | 'MALFORMED';

/**
 * Advances past a JSON string literal starting at `start` (which must index the opening `"`).
 * Returns the index just past the matching closing `"`. Does not decode escapes — an escaped
 * character (including an escaped quote, `\"`) is always exactly 2 source characters starting
 * with `\`, so unconditionally skipping 2 characters on any backslash can never mistake an
 * escaped quote for the literal's real terminator, regardless of which character is escaped.
 */
function skipJsonStringLiteral(rawText: string, start: number): number {
  let i = start + 1;
  while (i < rawText.length) {
    const ch = rawText[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * Decodes a JSON string literal's escape sequences (including `\uXXXX`, surrogate pairs
 * included) by delegating to the runtime's own JSON string grammar, rather than reimplementing
 * Unicode escape decoding by hand.
 */
function decodeJsonStringLiteral(literalWithQuotes: string): string | null {
  try {
    const decoded: unknown = JSON.parse(literalWithQuotes);
    return typeof decoded === 'string' ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Yields the *decoded* name of every JSON object key at the outermost (depth-1) object level of
 * `rawText`, in source order — decoded per JSON string-escape rules, not raw source spelling, so
 * an escaped key like `"schemaVersion"` is correctly recognized as `schemaVersion` rather
 * than silently missed by a literal-byte comparison. Assumes `rawText` already parsed
 * successfully as a JSON object (caller's responsibility) — this is a key enumeration over
 * already-known-valid JSON syntax, not a general JSON validator.
 */
function* topLevelObjectKeys(rawText: string): Generator<string> {
  let depth = 0;
  let i = 0;
  while (i < rawText.length) {
    const ch = rawText[i];
    if (ch === '"') {
      const stringStart = i;
      i = skipJsonStringLiteral(rawText, i);
      if (depth === 1) {
        let j = i;
        while (j < rawText.length && /\s/.test(rawText[j] ?? '')) j++;
        if (rawText[j] === ':') {
          const decoded = decodeJsonStringLiteral(rawText.slice(stringStart, i));
          if (decoded !== null) yield decoded;
        }
      }
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
    i++;
  }
}

/**
 * True when `key` appears more than once as a property name at the outermost object level of
 * `rawText`. Standard JSON parsers (`JSON.parse`, `serde_json`) silently keep only the last
 * occurrence of a duplicate key, so detecting a duplicate must run on the raw text, not a parsed
 * value — see the contract's "reject duplicate version keys consistently" requirement.
 */
function hasDuplicateTopLevelKey(rawText: string, key: string): boolean {
  let occurrences = 0;
  for (const foundKey of topLevelObjectKeys(rawText)) {
    if (foundKey === key) {
      occurrences++;
      if (occurrences > 1) return true;
    }
  }
  return false;
}

/** Parses `rawText` as a JSON object (not array, not primitive); `null` on any failure. */
function tryParseJsonObject(rawText: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/** The accepted `schemaVersion` value grammar: a non-negative integer JSON number. */
function isValidSchemaVersionValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Classifies an already-validated, present `schemaVersion` integer against the current build. */
function classifyVersionNumber(version: number): ProjectVersionClassification {
  if (version < CURRENT_PROJECT_SCHEMA_VERSION) {
    return SUPPORTED_OLDER_SOURCE_VERSIONS.has(version) ? 'SUPPORTED_OLDER' : 'UNSUPPORTED_OLDER';
  }
  if (version === CURRENT_PROJECT_SCHEMA_VERSION) {
    return 'CURRENT';
  }
  return 'FUTURE';
}

/**
 * Classifies raw persisted-project JSON text by its `schemaVersion`, per contract section 2.4:
 * a minimal raw/header parse extracting only `schemaVersion`, performed *before* any full typed
 * parse — so a `FUTURE` document with a breaking shape change still classifies `FUTURE`, never
 * `MALFORMED`. Field absence, present-invalid values, and duplicate keys are handled per the
 * contract's accepted value grammar (section 2.4's corrections).
 */
export function classifyRawProjectVersion(rawText: string): ProjectVersionClassification {
  const record = tryParseJsonObject(rawText);
  if (record === null) return 'MALFORMED';
  if (hasDuplicateTopLevelKey(rawText, 'schemaVersion')) return 'MALFORMED';
  if (!('schemaVersion' in record)) return 'LEGACY_UNVERSIONED';

  const value = record['schemaVersion'];
  if (!isValidSchemaVersionValue(value)) return 'MALFORMED';

  return classifyVersionNumber(value);
}

export interface LegacyToV1Result {
  readonly stamped: Record<string, unknown>;
  readonly sourceKeys: readonly string[];
}

function isEntityStateLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record['ids']) && typeof record['entities'] === 'object';
}

/**
 * Minimal structural verification that `payload` plausibly conforms to `PROJECT_SCHEMA_V1`'s
 * currently-modeled field set (contract section 2.1.1's `MODEL_AND_VALIDATE` row: `title`,
 * `characters`, `worlds`, `manuscript`) — the real "verify" action `LEGACY_TO_V1` requires
 * (contract section 2.4), not the silent no-op an earlier draft of `stampLegacyToV1` performed.
 * Deliberately not a full `ProjectData` validator: every other field is
 * `OUT_OF_SCOPE_BUT_MUST_NOT_BE_DROPPED` and is not checked here (per-field graduation to
 * `MODEL_AND_VALIDATE` is gradual, contract section 3) — but stamping a payload that fails even
 * this minimal shape check would let clearly-invalid legacy data pass through as if it were a
 * valid current record.
 */
function looksLikeMinimalProjectSchemaV1(payload: Record<string, unknown>): boolean {
  if (typeof payload['title'] !== 'string') return false;
  if (!Array.isArray(payload['manuscript'])) return false;
  const isArrayOrEntityState = (value: unknown): boolean =>
    Array.isArray(value) || isEntityStateLike(value);
  return isArrayOrEntityState(payload['characters']) && isArrayOrEntityState(payload['worlds']);
}

/**
 * `LEGACY_TO_V1` (contract section 2.4): the explicit, registered migration step for a
 * `LEGACY_UNVERSIONED` record. Not a silent alias into `PROJECT_SCHEMA_V1`'s dispatch point —
 * this performs the real "recognize -> verify -> stamp" actions. Callers are responsible for the
 * remaining "no-loss verify -> durably commit" steps (contract section 4), since those require
 * comparing against the actual pre-migration persisted record in the caller's storage context,
 * which this pure function does not have access to.
 *
 * @param legacyPayload A parsed JSON object already recognized as `LEGACY_UNVERSIONED` (i.e.
 *   `classifyRawProjectVersion` on its raw text returned `LEGACY_UNVERSIONED`). This function
 *   does not re-verify that precondition; callers must classify first.
 * @returns `null` when `legacyPayload` fails the minimal `PROJECT_SCHEMA_V1` shape verification —
 *   callers must route this to the same `MALFORMED`/recovery handling as any other invalid
 *   legacy record, never treat it as if verification had been skipped.
 */
export function stampLegacyToV1(legacyPayload: Record<string, unknown>): LegacyToV1Result | null {
  if (!looksLikeMinimalProjectSchemaV1(legacyPayload)) {
    return null;
  }
  return {
    stamped: { ...legacyPayload, schemaVersion: PROJECT_SCHEMA_V1 },
    sourceKeys: Object.keys(legacyPayload),
  };
}
