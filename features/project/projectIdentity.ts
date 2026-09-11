/**
 * projectIdentity.ts
 * -------------------
 * Shared "is this still the same active project" identity check. Guards a late-arriving async
 * result (AI generation, snapshot restore) against being applied to the wrong project after the
 * user has switched away (or reset/imported a different project) while the request was in flight.
 */
import { appStoreRef } from '../../app/storeRef';

const LEGACY_PROJECT_DIRECTORY_METADATA_KEY = '__worldscriptLegacyProjectDirectory';

// QNBS-v3: compare only storage-owned target identity so mutable snapshot/generation content cannot hide a project switch.
export function getProjectTargetIdentity(project: unknown): string | null {
  if (typeof project !== 'object' || project === null) return null;
  const record = project as Record<string, unknown>;
  if (typeof record['id'] === 'string' && record['id']) return `id:${record['id']}`;
  const legacyDirectory = record[LEGACY_PROJECT_DIRECTORY_METADATA_KEY];
  return typeof legacyDirectory === 'string' && legacyDirectory
    ? `legacy:${legacyDirectory}`
    : null;
}

// QNBS-v3: reads the live store directly (not a React selector) so a hook can capture identity at dispatch time and re-check it after an await, independent of that hook's own render cycle.
export function captureActiveProjectIdentity(): string | null {
  const state = appStoreRef.current?.getState();
  return getProjectTargetIdentity(state?.project?.present?.data);
}
