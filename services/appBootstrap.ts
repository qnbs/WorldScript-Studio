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
  const [settings, projectIds] = await Promise.all([
    storageService.loadSettings(),
    storageService.listProjects(),
  ]);
  // QNBS-v3: single-project mode on desktop (mirrors IdbProjectStore's own "single active project" contract).
  const projectId = projectIds[0];
  const project = projectId ? await storageService.loadProject(projectId) : null;
  if (!settings && !project) return undefined;
  const result: PersistedRootState = {};
  if (settings) result.settings = settings;
  // QNBS-v3: flat shape — the existing hydration logic below reconstructs the redux-undo envelope
  // from `project.data` regardless of which backend produced it.
  if (project) result.project = { data: project as unknown as ProjectData };
  return result;
}
