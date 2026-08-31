/**
 * Tests for services/appBootstrap.ts
 * QNBS-v3 (#332/D1): the desktop build never read persisted state back at cold boot —
 * `index.tsx`'s old inline hydration called the raw IndexedDB-only `dbService.loadState()`
 * unconditionally, with zero Tauri branching, even though every save path already routed through
 * the Tauri-aware `storageService`. Verifies the fixed branch: web uses `dbService.loadState()`,
 * desktop uses `storageService.loadSettings()`/`listProjects()`/`loadProject()` and never touches
 * `dbService`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedRootState } from '../../../types';

const h = vi.hoisted(() => ({
  isTauri: { value: false },
  dbLoadState: vi.fn(),
  loadSettings: vi.fn(),
  listProjects: vi.fn(),
  loadProject: vi.fn(),
  getActiveProjectId: vi.fn(),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => h.isTauri.value,
}));

vi.mock('../../../services/dbService', () => ({
  dbService: { loadState: h.dbLoadState },
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadSettings: h.loadSettings,
    listProjects: h.listProjects,
    loadProject: h.loadProject,
    getActiveProjectId: h.getActiveProjectId,
  },
}));

import {
  getPersistedProjectPayload,
  loadPersistedRootState,
  shouldAllowInitialMetadataSeed,
} from '../../../services/appBootstrap';

describe('loadPersistedRootState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isTauri.value = false;
    h.dbLoadState.mockResolvedValue(undefined);
    h.loadSettings.mockResolvedValue(null);
    h.listProjects.mockResolvedValue([]);
    h.loadProject.mockResolvedValue(null);
    h.getActiveProjectId.mockResolvedValue(null);
  });

  it('on the web, reads via dbService.loadState() and never touches storageService', async () => {
    h.dbLoadState.mockResolvedValue({ settings: { theme: 'dark' } });
    const result = await loadPersistedRootState();
    expect(result).toEqual({ settings: { theme: 'dark' } });
    expect(h.dbLoadState).toHaveBeenCalledTimes(1);
    expect(h.loadSettings).not.toHaveBeenCalled();
    expect(h.listProjects).not.toHaveBeenCalled();
    expect(h.loadProject).not.toHaveBeenCalled();
  });

  it('on desktop, reads via storageService and never touches dbService.loadState()', async () => {
    h.isTauri.value = true;
    h.loadSettings.mockResolvedValue({ theme: 'sepia' });
    h.listProjects.mockResolvedValue(['proj-1']);
    h.loadProject.mockResolvedValue({ id: 'proj-1', title: 'My Novel' });

    const result = await loadPersistedRootState();

    expect(h.dbLoadState).not.toHaveBeenCalled();
    expect(h.loadSettings).toHaveBeenCalledTimes(1);
    expect(h.listProjects).toHaveBeenCalledTimes(1);
    expect(h.loadProject).toHaveBeenCalledWith('proj-1');
    expect(result?.settings).toEqual({ theme: 'sepia' });
    // Flat shape — index.tsx's existing hydration logic reconstructs the redux-undo envelope.
    expect(result?.project).toEqual({ data: { id: 'proj-1', title: 'My Novel' } });
  });

  it('on desktop with no persisted settings or projects, returns undefined (fresh user)', async () => {
    h.isTauri.value = true;
    const result = await loadPersistedRootState();
    expect(result).toBeUndefined();
    expect(h.loadProject).not.toHaveBeenCalled();
  });

  it('on desktop with settings but no projects, returns settings only', async () => {
    h.isTauri.value = true;
    h.loadSettings.mockResolvedValue({ theme: 'light' });
    const result = await loadPersistedRootState();
    expect(result).toEqual({ settings: { theme: 'light' } });
    expect(result?.project).toBeUndefined();
  });

  // QNBS-v3 (#332): covers desktop boot's active-project restoration — marker preferred, deleted-project marker and no-marker both fall back to the first listed project id.
  it('on desktop with no active-project marker, falls back to the first listed project id', async () => {
    h.isTauri.value = true;
    h.listProjects.mockResolvedValue(['proj-1', 'proj-2']);
    h.getActiveProjectId.mockResolvedValue(null);
    h.loadProject.mockResolvedValue({ id: 'proj-1', title: 'First' });
    await loadPersistedRootState();
    expect(h.loadProject).toHaveBeenCalledTimes(1);
    expect(h.loadProject).toHaveBeenCalledWith('proj-1');
  });

  it('on desktop, prefers the active-project marker over the first listed project id', async () => {
    h.isTauri.value = true;
    h.listProjects.mockResolvedValue(['proj-1', 'proj-2']);
    h.getActiveProjectId.mockResolvedValue('proj-2');
    h.loadProject.mockResolvedValue({ id: 'proj-2', title: 'Second' });
    await loadPersistedRootState();
    expect(h.loadProject).toHaveBeenCalledTimes(1);
    expect(h.loadProject).toHaveBeenCalledWith('proj-2');
  });

  it('on desktop, falls back to the first listed project id when the marker points to a deleted project', async () => {
    h.isTauri.value = true;
    h.listProjects.mockResolvedValue(['proj-1', 'proj-2']);
    h.getActiveProjectId.mockResolvedValue('proj-deleted');
    h.loadProject.mockResolvedValue({ id: 'proj-1', title: 'First' });
    await loadPersistedRootState();
    expect(h.loadProject).toHaveBeenCalledTimes(1);
    expect(h.loadProject).toHaveBeenCalledWith('proj-1');
  });
});

describe('shouldAllowInitialMetadataSeed', () => {
  // QNBS-v3: verifies metadata seeding follows hydrated project presence instead of any persisted root state.
  it('allows seeding when no persisted root state exists', () => {
    expect(shouldAllowInitialMetadataSeed(undefined)).toBe(true);
  });

  it('allows seeding when settings were restored without a project', () => {
    const settingsOnlyState = { settings: {} } as unknown as PersistedRootState;
    expect(shouldAllowInitialMetadataSeed(settingsOnlyState)).toBe(true);
  });

  it('allows seeding when a persisted project envelope has no actual payload', () => {
    const malformedState = {
      project: { present: {} },
      settings: {},
    } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(malformedState.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(malformedState)).toBe(true);
  });

  it('does not allow seeding after a persisted project was hydrated', () => {
    const hydratedProjectState = {
      project: { present: { data: {} } },
    } as unknown as PersistedRootState;
    expect(shouldAllowInitialMetadataSeed(hydratedProjectState)).toBe(false);
  });
});
