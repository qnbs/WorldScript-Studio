import type { ProjectData } from '../features/project/projectSlice';
import type { PersistedRootState } from '../types';
import { dbService } from './dbService';
import { storageService } from './storageService';
import { isTauriRuntime } from './tauriRuntime';

/**
 * QNBS-v3 (#332): every persisted-state write on desktop already routes through `storageService`
 * (Tauri-filesystem-aware) — `app/listenerMiddleware.ts`'s autosaves and `index.tsx`'s own
 * `visibilitychange` flush (via `app/persistedStateFlush.ts`) all use it. `dbService.loadState()` is
 * a raw IndexedDB-only read with zero Tauri branching; on the desktop build nothing was ever read
 * back at cold boot, so every launch hydrated as a brand-new user regardless of what was actually
 * saved to disk. This mirrors the save path instead of reading IndexedDB unconditionally. Extracted
 * out of `index.tsx` (a side-effect-heavy entry module that boots the whole app on import) so this
 * branch is directly unit-testable.
 */
export async function loadPersistedRootState(): Promise<PersistedRootState | undefined> {
  if (!isTauriRuntime()) {
    const loadedState = await dbService.loadState();
    return loadedState as PersistedRootState | undefined;
  }
  const [settings, projectIds, activeProjectId] = await Promise.all([
    storageService.loadSettings(),
    storageService.listProjects(),
    storageService.getActiveProjectId(),
  ]);
  // QNBS-v3 (#332): prefer the last-saved project's marker over projectIds[0] — readDir() order isn't recency, so an arbitrary first entry could hydrate a stale project. Falls back to projectIds[0] for pre-marker installs or a since-deleted active project.
  const projectId =
    activeProjectId && projectIds.includes(activeProjectId) ? activeProjectId : projectIds[0];
  const project = projectId ? await storageService.loadProject(projectId) : null;
  if (!settings && !project) return undefined;
  const result: PersistedRootState = {};
  if (settings) result.settings = settings;
  // QNBS-v3: flat shape — the existing hydration logic below reconstructs the redux-undo envelope
  // from `project.data` regardless of which backend produced it.
  if (project) result.project = { data: project as unknown as ProjectData };
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasEntityStateShape(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value['ids']) || !isRecord(value['entities']))
    return false;
  return value['ids'].every((id: unknown) => typeof id === 'string');
}

// QNBS-v3: structural project evidence prevents malformed envelopes from suppressing fresh seeding while preserving partial metadata repair.
export function getPersistedProjectPayload(
  project: PersistedRootState['project'] | undefined,
): ProjectData | undefined {
  const payload = project?.present?.data ?? project?.data;
  if (!isRecord(payload)) return undefined;
  if (
    !hasEntityStateShape(payload.characters) ||
    !hasEntityStateShape(payload.worlds) ||
    !Array.isArray(payload.outline) ||
    !Array.isArray(payload.manuscript)
  )
    return undefined;
  return payload as ProjectData;
}

// QNBS-v3: seed authority follows hydrated project presence, so settings-only state can still initialize the synthetic project without overwriting real user intent.
export function shouldAllowInitialMetadataSeed(
  preloadedState: PersistedRootState | undefined,
): boolean {
  return getPersistedProjectPayload(preloadedState?.project) === undefined;
}
