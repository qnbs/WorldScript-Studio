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

function overlayCurrentSchemaVersion(raw: CanonicalProjectRawPayload): string | null {
  const objectStart = raw.search(/\S/);
  if (objectStart === -1 || raw[objectStart] !== '{') return null;

  let firstMember = objectStart + 1;
  while (/\s/.test(raw[firstMember] ?? '')) firstMember++;
  const isEmptyObject = raw[firstMember] === '}';
  const separator = isEmptyObject ? '' : ',';
  return `${raw.slice(0, objectStart + 1)}"schemaVersion":${CURRENT_PROJECT_SCHEMA_VERSION}${separator}${raw.slice(objectStart + 1)}`;
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
