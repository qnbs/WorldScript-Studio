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
 * Scans raw JSON text for more than one occurrence of `key` as a property name at the outermost
 * object level. Standard JSON parsers (`JSON.parse`, `serde_json`) silently keep only the last
 * occurrence of a duplicate key, so detecting a duplicate must run on the raw text, not a parsed
 * value — see the contract's "reject duplicate version keys consistently" requirement.
 *
 * Assumes `rawText` already parsed successfully as a JSON object (caller's responsibility); this
 * is a key-occurrence count over already-known-valid JSON syntax, not a general JSON validator.
 */
function hasDuplicateTopLevelKey(rawText: string, key: string): boolean {
  const quoted = `"${key}"`;
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let occurrences = 0;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      if (depth === 1 && rawText.startsWith(quoted, i)) {
        let j = i + quoted.length;
        while (j < rawText.length && /\s/.test(rawText[j] ?? '')) j++;
        if (rawText[j] === ':') {
          occurrences++;
          if (occurrences > 1) return true;
        }
      }
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return false;
}

/**
 * Classifies raw persisted-project JSON text by its `schemaVersion`, per contract section 2.4:
 * a minimal raw/header parse extracting only `schemaVersion`, performed *before* any full typed
 * parse — so a `FUTURE` document with a breaking shape change still classifies `FUTURE`, never
 * `MALFORMED`. Field absence, present-invalid values, and duplicate keys are handled per the
 * contract's accepted value grammar (section 2.4's corrections).
 */
export function classifyRawProjectVersion(rawText: string): ProjectVersionClassification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return 'MALFORMED';
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'MALFORMED';
  }

  if (hasDuplicateTopLevelKey(rawText, 'schemaVersion')) {
    return 'MALFORMED';
  }

  const record = parsed as Record<string, unknown>;
  if (!('schemaVersion' in record)) {
    return 'LEGACY_UNVERSIONED';
  }

  const value = record['schemaVersion'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return 'MALFORMED';
  }

  if (value < CURRENT_PROJECT_SCHEMA_VERSION) {
    return SUPPORTED_OLDER_SOURCE_VERSIONS.has(value) ? 'SUPPORTED_OLDER' : 'UNSUPPORTED_OLDER';
  }
  if (value === CURRENT_PROJECT_SCHEMA_VERSION) {
    return 'CURRENT';
  }
  return 'FUTURE';
}

export interface LegacyToV1Result {
  readonly stamped: Record<string, unknown>;
  readonly sourceKeys: readonly string[];
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
 */
export function stampLegacyToV1(legacyPayload: Record<string, unknown>): LegacyToV1Result {
  return {
    stamped: { ...legacyPayload, schemaVersion: PROJECT_SCHEMA_V1 },
    sourceKeys: Object.keys(legacyPayload),
  };
}
