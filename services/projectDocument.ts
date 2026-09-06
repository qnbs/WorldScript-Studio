import {
  classifyRawProjectVersion,
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
  /** Header verdict; typed projection is present only for admitted legacy/current input. */
  classification: ProjectVersionClassification;
  /** Original payload, including fields and numeric literals the current projection does not model. */
  raw: CanonicalProjectRawPayload;
  /** V1-owned projection; this is a view and never the persistence source. */
  projection: TProjection | null;
  /** Validation detail when the payload cannot produce an admitted projection. */
  error: string | null;
}

function validationError(result: {
  error: { issues: Array<{ path: PropertyKey[]; message: string }> };
}) {
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
  return `Invalid project file: ${detail}`;
}

/**
 * Parses one project document into its canonical raw carrier and the bounded V1-owned projection.
 * Header classification happens first so future and migration-gap payloads are preserved without
 * being forced through a current typed schema; a current typed failure is MALFORMED instead of
 * receiving editable authority.
 */
export function parseCanonicalProjectDocument<TProjection>(
  text: string,
  schema: {
    safeParse(value: unknown): CanonicalProjectSchemaResult<TProjection>;
  },
): CanonicalProjectDocument<TProjection> {
  const classification = classifyRawProjectVersion(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      classification: 'MALFORMED',
      raw: text,
      projection: null,
      error: 'Invalid project file: not valid JSON.',
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      classification: 'MALFORMED',
      raw: text,
      projection: null,
      error: 'Invalid project file: the document must be a JSON object.',
    };
  }

  if (classification !== 'LEGACY_UNVERSIONED' && classification !== 'CURRENT') {
    return {
      classification,
      raw: text,
      projection: null,
      error: null,
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      classification: 'MALFORMED',
      raw: text,
      projection: null,
      error: validationError(result),
    };
  }

  return {
    classification,
    raw: text,
    projection: result.data,
    error: null,
  };
}
