import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  classifyRawProjectVersionFromParsed,
  type ProjectVersionClassification,
} from '../features/project/projectSchemaVersion';

/** The original JSON text retained as the lossless carrier for a project document. */
export type CanonicalProjectRawPayload = string;

export type CanonicalProjectSchemaResult<TProjection> =
  | { success: true; data: TProjection }
  | {
      success: false;
      error: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };

export interface CanonicalProjectDocument<TProjection> {
  /** Final admission/recovery verdict; a current header with invalid owned fields becomes MALFORMED. */
  classification: ProjectVersionClassification;
  /** Raw/header verdict retained separately so recovery can distinguish CURRENT from malformed data. */
  headerClassification: ProjectVersionClassification;
  /** Original payload, including fields and numeric literals the current projection does not model. */
  raw: CanonicalProjectRawPayload;
  /** V1-owned projection; this is a view and never the persistence source. */
  projection: TProjection | null;
  /** Validation detail when the payload cannot produce an admitted projection. */
  error: string | null;
}

export type CanonicalProjectAdmissionStatus = 'CURRENT' | 'LEGACY_TO_V1' | 'REFUSED';

export interface CanonicalProjectAdmission<TProjection> {
  /** The source verdict remains available for migration provenance and recovery diagnostics. */
  source: CanonicalProjectDocument<TProjection>;
  /** A current document after validation, or null when no editable projection was admitted. */
  canonical: CanonicalProjectDocument<TProjection> | null;
  /** LEGACY_TO_V1 is distinct from an already-current source even when the destination is V1. */
  status: CanonicalProjectAdmissionStatus;
}

type CanonicalRawObjectMember = {
  key: string;
  start: number;
  valueEnd: number;
};

function validationError(result: {
  error: { issues: Array<{ path: PropertyKey[]; message: string }> };
}) {
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return `Invalid project file: ${detail}`;
}

function shouldProjectClassification(classification: ProjectVersionClassification): boolean {
  return classification === 'LEGACY_UNVERSIONED' || classification === 'CURRENT';
}

/**
 * Parses one project document into its canonical raw carrier and the bounded V1-owned projection.
 * Raw header checks happen before typed validation so future and migration-gap payloads are
 * preserved without receiving editable authority.
 */
// QNBS-v3: classify version before typed projection so unsupported input stays preserve-first and noneditable.
export function parseCanonicalProjectDocument<TProjection>(
  text: string,
  schema: {
    safeParse(value: unknown): CanonicalProjectSchemaResult<TProjection>;
  },
): CanonicalProjectDocument<TProjection> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      classification: 'MALFORMED',
      headerClassification: 'MALFORMED',
      raw: text,
      projection: null,
      error: 'Invalid project file: not valid JSON.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      classification: 'MALFORMED',
      headerClassification: 'MALFORMED',
      raw: text,
      projection: null,
      error: 'Invalid project file: the document must be a JSON object.',
    };
  }

  // QNBS-v3: reuse the validated object so raw admission and typed projection do not double-parse large imports.
  const classification = classifyRawProjectVersionFromParsed(
    text,
    parsed as Record<string, unknown>,
  );
  if (!shouldProjectClassification(classification)) {
    return {
      classification,
      headerClassification: classification,
      raw: text,
      projection: null,
      error: null,
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      classification: 'MALFORMED',
      headerClassification: classification,
      raw: text,
      projection: null,
      error: validationError(result),
    };
  }

  return {
    classification,
    headerClassification: classification,
    raw: text,
    projection: result.data,
    error: null,
  };
}

// QNBS-v3: stamp legacy JSON without reserializing opaque numeric literals or nested payloads.
function overlayCurrentSchemaVersion(raw: CanonicalProjectRawPayload): string | null {
  const objectStart = raw.search(/\S/);
  if (objectStart === -1 || raw[objectStart] !== '{') return null;

  let firstMember = objectStart + 1;
  while (/\s/.test(raw[firstMember] ?? '')) firstMember++;
  const isEmptyObject = raw[firstMember] === '}';
  const separator = isEmptyObject ? '' : ',';
  return `${raw.slice(0, objectStart + 1)}"schemaVersion":${CURRENT_PROJECT_SCHEMA_VERSION}${separator}${raw.slice(objectStart + 1)}`;
}

function skipRawJsonString(raw: string, start: number): number | null {
  let index = start + 1;
  while (index < raw.length) {
    if (raw[index] === '\\') {
      index += 2;
      continue;
    }
    if (raw[index] === '"') return index + 1;
    index++;
  }
  return null;
}

function skipRawJsonWhitespace(raw: string, start: number): number {
  let index = start;
  while (/\s/.test(raw[index] ?? '')) index++;
  return index;
}

function skipRawJsonScalar(raw: string, start: number): number {
  let index = start;
  while (index < raw.length && raw[index] !== ',' && raw[index] !== '}') index++;
  return index;
}

function skipRawJsonContainer(raw: string, start: number): number | null {
  let depth = 0;
  let index = start;
  while (index < raw.length) {
    const character = raw[index];
    if (character === '"') {
      const stringEnd = skipRawJsonString(raw, index);
      if (stringEnd === null) return null;
      index = stringEnd;
      continue;
    }
    if (character === '{' || character === '[') {
      depth++;
    } else if (character === '}' || character === ']') {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return null;
}

function skipRawJsonValue(raw: string, start: number): number | null {
  if (raw[start] === '"') return skipRawJsonString(raw, start);
  if (raw[start] === '{' || raw[start] === '[') return skipRawJsonContainer(raw, start);
  return skipRawJsonScalar(raw, start);
}

function readRawObjectKey(raw: string, start: number): { key: string; end: number } | null {
  const keyEnd = skipRawJsonString(raw, start);
  if (keyEnd === null) return null;
  try {
    const key: unknown = JSON.parse(raw.slice(start, keyEnd));
    return typeof key === 'string' ? { key, end: keyEnd } : null;
  } catch {
    return null;
  }
}

function readRawObjectMember(raw: string, start: number): CanonicalRawObjectMember | null {
  const parsedKey = readRawObjectKey(raw, start);
  if (parsedKey === null) return null;

  let index = skipRawJsonWhitespace(raw, parsedKey.end);
  if (raw[index] !== ':') return null;
  index = skipRawJsonWhitespace(raw, index + 1);
  const valueEnd = skipRawJsonValue(raw, index);
  if (valueEnd === null) return null;
  return { key: parsedKey.key, start, valueEnd };
}

function readTopLevelObjectMembers(raw: string): CanonicalRawObjectMember[] | null {
  const objectStart = raw.search(/\S/);
  if (objectStart === -1 || raw[objectStart] !== '{') return null;

  const members: CanonicalRawObjectMember[] = [];
  let index = skipRawJsonWhitespace(raw, objectStart + 1);
  if (raw[index] === '}') return members;

  while (index < raw.length) {
    const member = readRawObjectMember(raw, index);
    if (member === null) return null;
    members.push(member);

    index = skipRawJsonWhitespace(raw, member.valueEnd);
    if (raw[index] === '}') return members;
    if (raw[index] !== ',') return null;
    index = skipRawJsonWhitespace(raw, index + 1);
  }
  return null;
}

/** Removes backend-local top-level metadata while preserving every other raw JSON token. */
// QNBS-v3: strip machine-local trust metadata only at the portable import boundary without narrowing opaque data.
export function stripTopLevelObjectKeys(
  raw: CanonicalProjectRawPayload,
  keys: ReadonlySet<string>,
): CanonicalProjectRawPayload | null {
  if (keys.size === 0) return raw;
  const members = readTopLevelObjectMembers(raw);
  if (members === null) return null;

  const removalSpans = members.flatMap((member, index) => {
    if (!keys.has(member.key)) return [];
    const nextMember = members[index + 1];
    if (nextMember) {
      return [{ start: member.start, end: nextMember.start }];
    }
    const previousMember = members[index - 1];
    if (previousMember) {
      return [{ start: previousMember.valueEnd, end: member.valueEnd }];
    }
    return [{ start: member.start, end: member.valueEnd }];
  });
  if (removalSpans.length === 0) return raw;

  const mergedSpans = removalSpans
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((merged, span) => {
      const previous = merged.at(-1);
      if (previous && span.start <= previous.end) {
        previous.end = Math.max(previous.end, span.end);
      } else {
        merged.push({ ...span });
      }
      return merged;
    }, []);

  let result = '';
  let cursor = 0;
  for (const span of mergedSpans) {
    result += raw.slice(cursor, span.start);
    cursor = span.end;
  }
  return result + raw.slice(cursor);
}

/**
 * Performs the non-destructive in-memory LEGACY_TO_V1 admission step.
 * The durable source-generation fence and writer integration remain separate gates.
 */
export function admitCanonicalProjectDocument<TProjection>(
  text: string,
  schema: {
    safeParse(value: unknown): CanonicalProjectSchemaResult<TProjection>;
  },
): CanonicalProjectAdmission<TProjection> {
  // QNBS-v3: refuse unsupported or invalid states before granting any editable migration authority.
  const source = parseCanonicalProjectDocument(text, schema);

  if (source.classification === 'CURRENT' && source.projection !== null) {
    return { source, canonical: source, status: 'CURRENT' };
  }

  if (source.classification !== 'LEGACY_UNVERSIONED' || source.projection === null) {
    return { source, canonical: null, status: 'REFUSED' };
  }

  const migratedRaw = overlayCurrentSchemaVersion(source.raw);
  if (migratedRaw === null) return { source, canonical: null, status: 'REFUSED' };

  const canonical = parseCanonicalProjectDocument(migratedRaw, schema);
  if (canonical.classification !== 'CURRENT' || canonical.projection === null) {
    return { source, canonical: null, status: 'REFUSED' };
  }

  return { source, canonical, status: 'LEGACY_TO_V1' };
}
