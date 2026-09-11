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

function baseTargetIdentity(project: unknown): string | null {
  if (typeof project !== 'object' || project === null) return null;
  const record = project as Record<string, unknown>;
  if (typeof record['id'] === 'string' && record['id']) return `id:${record['id']}`;
  const legacyDirectory = record[LEGACY_PROJECT_DIRECTORY_METADATA_KEY];
  return typeof legacyDirectory === 'string' && legacyDirectory
    ? `legacy:${legacyDirectory}`
    : null;
}

// QNBS-v3: incorporates the in-memory generation counter, not just the persisted id -- a fresh "New Project" always reuses id:'default' until explicitly saved elsewhere, so id alone cannot distinguish two different reset/import/restore sessions.
export function getProjectTargetIdentity(
  source: ProjectIdentitySource | null | undefined,
): string | null {
  if (!source) return null;
  const base = baseTargetIdentity(source.data);
  return base === null ? null : `${base}:gen:${source.generation ?? 0}`;
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

/** rejectWithValue payload for an AI result discarded because the active project changed while it was in flight. */
export interface StaleProjectRejection {
  readonly staleProject: true;
}

export function staleProjectRejection(): StaleProjectRejection {
  return { staleProject: true };
}

// QNBS-v3: distinguishes a deliberate stale-project discard from a genuine provider/network failure so callers can stay silent instead of showing an error toast for a mere project switch.
export function isStaleProjectRejection(payload: unknown): payload is StaleProjectRejection {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as Record<string, unknown>)['staleProject'] === true
  );
}
