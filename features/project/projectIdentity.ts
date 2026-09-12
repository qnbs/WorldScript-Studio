/**
 * projectIdentity.ts
 * -------------------
 * Shared "is this still the same active project" identity check. Guards a late-arriving async
 * result (AI generation, snapshot restore) against being applied to the wrong project after the
 * user has switched away (or reset/imported a different project) while the request was in flight.
 */
import { appStoreRef } from '../../app/storeRef';

const LEGACY_PROJECT_DIRECTORY_METADATA_KEY = '__worldscriptLegacyProjectDirectory';

interface ProjectIdentitySource {
  data: unknown;
  generation?: number;
}

export const STALE_PROJECT_OPERATION_ERROR_NAME = 'StaleProjectOperationError';

/** Error used when an async result can no longer prove that its origin project is active. */
export class StaleProjectOperationError extends Error {
  readonly code = 'STALE_PROJECT_OPERATION';

  constructor(operation: string) {
    super(`Discarded stale project operation: ${operation}`);
    this.name = STALE_PROJECT_OPERATION_ERROR_NAME;
  }
}

export function isStaleProjectOperationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === STALE_PROJECT_OPERATION_ERROR_NAME
  );
}

function baseTargetIdentity(project: unknown): string | null {
  if (typeof project !== 'object' || project === null) return null;
  const record = project as Record<string, unknown>;
  if (typeof record['id'] === 'string' && record['id']) return `id:${record['id']}`;
  const legacyDirectory = record[LEGACY_PROJECT_DIRECTORY_METADATA_KEY];
  return typeof legacyDirectory === 'string' && legacyDirectory
    ? `legacy:${legacyDirectory}`
    : null;
}

// QNBS-v3: [Generation fence / Reject same-ID stale mutations / Preserve project-incarnation ownership]
export function getProjectTargetIdentity(
  source: ProjectIdentitySource | null | undefined,
): string | null {
  if (!source) return null;
  const base = baseTargetIdentity(source.data);
  return base === null ? null : `${base}:gen:${source.generation ?? 0}`;
}

// QNBS-v3: [Legacy directory identity / Keep storage owner stable / Preserve compatibility without generation aliases]
export function getProjectTargetStorageId(
  source: ProjectIdentitySource | null | undefined,
): string | null {
  if (!source) return null;
  const base = baseTargetIdentity(source.data);
  if (base === null) return null;
  return base.startsWith('id:') ? base.slice('id:'.length) : base;
}

// QNBS-v3: reads the live store directly (not a React selector) so a hook can capture identity at dispatch time and re-check it after an await, independent of that hook's own render cycle.
export function captureActiveProjectIdentity(): string | null {
  const state = appStoreRef.current?.getState();
  return getProjectTargetIdentity(state?.project?.present);
}

// QNBS-v3: null means identity could not be determined -- fail closed (never "unchanged") so a guard never allows a mutation it can't actually prove is still targeting the right project.
export function identityUnchanged(captured: string | null, live: string | null): boolean {
  return captured !== null && captured === live;
}

// QNBS-v3: centralizes the fail-closed throw so direct async project mutations produce one
// serialized rejection and the global error listener can suppress stale-result noise.
export function assertProjectIdentityUnchanged(
  captured: string | null,
  live: string | null,
  operation: string,
): void {
  if (!identityUnchanged(captured, live)) {
    throw new StaleProjectOperationError(operation);
  }
}
