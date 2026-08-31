import type { EntityAdapter, EntityState } from '@reduxjs/toolkit';
import { charactersAdapter, worldsAdapter } from '../features/project/adapters';
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

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

// QNBS-v3: null-prototype entity records preserve legal persisted IDs that collide with Object.prototype during bootstrap.
function normalizeEntityCollection<T>(
  value: unknown,
  adapter: EntityAdapter<T, string>,
): EntityState<T, string> | undefined {
  if (Array.isArray(value)) {
    const ids: string[] = [];
    const entities = Object.create(null) as Record<string, T>;
    for (const entity of value) {
      if (!isRecord(entity) || typeof entity['id'] !== 'string' || !entity['id'].trim())
        return undefined;
      const id = entity['id'];
      if (hasOwn(entities, id)) return undefined;
      ids.push(id);
      entities[id] = entity as T;
    }
    return { ...adapter.getInitialState(), ids, entities };
  }

  if (!isRecord(value) || !Array.isArray(value['ids']) || !isRecord(value['entities']))
    return undefined;
  const sourceIds = value['ids'];
  const sourceEntities = value['entities'];
  const ids: string[] = [];
  const entities = Object.create(null) as Record<string, T>;
  const seenIds = new Set<string>();
  for (const id of sourceIds) {
    if (typeof id !== 'string' || !id.trim() || seenIds.has(id)) return undefined;
    if (!hasOwn(sourceEntities, id)) return undefined;
    const entity = sourceEntities[id];
    if (!isRecord(entity) || entity['id'] !== id) return undefined;
    seenIds.add(id);
    ids.push(id);
    entities[id] = entity as T;
  }
  for (const key of Reflect.ownKeys(sourceEntities)) {
    if (typeof key !== 'string' || !seenIds.has(key)) return undefined;
  }
  return { ...adapter.getInitialState(), ids, entities };
}

// QNBS-v3: canonical desktop collections prevent valid filesystem projects from being discarded while malformed envelopes remain non-authoritative.
export function getPersistedProjectPayload(
  project: PersistedRootState['project'] | undefined,
): ProjectData | undefined {
  const payload = project?.present?.data ?? project?.data;
  if (!isRecord(payload)) return undefined;
  const characters = normalizeEntityCollection(payload['characters'], charactersAdapter);
  const worlds = normalizeEntityCollection(payload['worlds'], worldsAdapter);
  if (!characters || !worlds || !Array.isArray(payload['manuscript'])) return undefined;
  const outline = payload['outline'];
  if (outline !== undefined && !Array.isArray(outline)) return undefined;
  return {
    ...payload,
    characters,
    worlds,
    outline: outline ?? [],
  } as unknown as ProjectData;
}

// QNBS-v3: the active payload is normalized before Redux-Undo sees it, preventing desktop array data from bypassing the canonical Redux state boundary.
export function normalizePersistedProjectForStore(
  project: PersistedRootState['project'] | undefined,
): PersistedRootState['project'] | undefined {
  const payload = getPersistedProjectPayload(project);
  if (!payload) return undefined;

  if (
    project &&
    isRecord(project.present) &&
    Array.isArray(project.past) &&
    Array.isArray(project.future)
  ) {
    const present = { ...project.present, data: payload };
    return {
      ...project,
      present,
      _latestUnfiltered: present,
    };
  }

  const present = { data: payload };
  return {
    past: [],
    present,
    future: [],
    _latestUnfiltered: present,
  };
}

// QNBS-v3: seed authority follows hydrated project presence, so settings-only state can still initialize the synthetic project without overwriting real user intent.
export function shouldAllowInitialMetadataSeed(
  preloadedState: PersistedRootState | undefined,
): boolean {
  return getPersistedProjectPayload(preloadedState?.project) === undefined;
}
