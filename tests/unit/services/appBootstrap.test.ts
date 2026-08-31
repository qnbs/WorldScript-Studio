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
import { charactersAdapter } from '../../../features/project/adapters';
import type { PersistedRootState } from '../../../types';

const createPersistedProject = (overrides: Record<string, unknown> = {}) => ({
  title: '',
  logline: '',
  characters: { ids: [], entities: {} },
  worlds: { ids: [], entities: {} },
  outline: [],
  manuscript: [],
  ...overrides,
});

const createDesktopProject = (overrides: Record<string, unknown> = {}) => ({
  title: '',
  logline: '',
  characters: [],
  worlds: [],
  manuscript: [],
  ...overrides,
});

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
  normalizePersistedProjectForStore,
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
      project: { present: { data: {} } },
      settings: {},
    } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(malformedState.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(malformedState)).toBe(true);
  });

  it('allows seeding when flat persisted project data is an empty object', () => {
    const malformedState = {
      project: { data: {} },
    } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(malformedState.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(malformedState)).toBe(true);
  });

  it('rejects flat arbitrary object-shaped project data as non-hydratable', () => {
    const malformedState = {
      project: { data: { foo: 'bar' } },
    } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(malformedState.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(malformedState)).toBe(true);
  });

  it('accepts a structurally genuine empty project without requiring metadata content', () => {
    const project = createPersistedProject();
    const state = { project: { data: project } } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(state.project)).toEqual(project);
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  it('does not allow seeding after a persisted project was hydrated', () => {
    const project = createPersistedProject({
      manuscript: [{ id: 'section-1', title: 'Existing', content: 'Valuable work' }],
    });
    const hydratedProjectState = {
      project: { present: { data: project } },
    } as unknown as PersistedRootState;
    expect(shouldAllowInitialMetadataSeed(hydratedProjectState)).toBe(false);
  });

  it('keeps a genuine project authoritative when title is missing', () => {
    const project = createPersistedProject({
      title: undefined,
      manuscript: [{ id: 'section-1', title: 'Existing', content: 'Valuable work' }],
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(state.project)).toEqual(project);
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  it('keeps a genuine project authoritative when logline is missing', () => {
    const project = createPersistedProject({
      logline: undefined,
      manuscript: [{ id: 'section-1', title: 'Existing', content: 'Valuable work' }],
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    expect(getPersistedProjectPayload(state.project)).toEqual(project);
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  // QNBS-v3: canonicalizes supported desktop persistence shapes before hydration authority can suppress fresh-project seeding.
  it('normalizes desktop arrays and an omitted outline into the Redux shape', () => {
    const project = createDesktopProject();
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload).toMatchObject({
      outline: [],
      manuscript: [],
    });
    expect(payload?.characters).toEqual({ ids: [], entities: {} });
    expect(payload?.worlds).toEqual({ ids: [], entities: {} });
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  it('preserves all entities when normalizing desktop character and world arrays', () => {
    const character = { id: 'character-1', name: 'Ada' };
    const world = { id: 'world-1', name: 'Arcadia' };
    const project = createDesktopProject({ characters: [character], worlds: [world] });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload?.characters).toEqual({
      ids: ['character-1'],
      entities: { 'character-1': character },
    });
    expect(payload?.worlds).toEqual({ ids: ['world-1'], entities: { 'world-1': world } });
  });

  it('preserves prototype-named array IDs in an adapter-compatible entity state', () => {
    const ids = ['__proto__', 'constructor', 'toString'];
    const project = createDesktopProject({
      characters: ids.map((id) => ({ id, name: `Character ${id}` })),
      worlds: ids.map((id) => ({ id, name: `World ${id}` })),
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload).toBeDefined();
    if (!payload) return;
    expect(Object.getPrototypeOf(payload.characters.entities)).toBeNull();
    expect(Object.getPrototypeOf(payload.worlds.entities)).toBeNull();
    for (const id of ids) {
      expect(payload.characters.ids).toContain(id);
      expect(Object.hasOwn(payload.characters.entities, id)).toBe(true);
      expect(payload.characters.entities[id]?.id).toBe(id);
      expect(payload.worlds.ids).toContain(id);
      expect(Object.hasOwn(payload.worlds.entities, id)).toBe(true);
      expect(payload.worlds.entities[id]?.id).toBe(id);
    }

    const updated = charactersAdapter.updateOne(payload.characters, {
      id: '__proto__',
      changes: { name: 'Updated' },
    });
    const updatedPrototypeCharacter = Object.getOwnPropertyDescriptor(updated.entities, '__proto__')
      ?.value as { name: string } | undefined;
    expect(updatedPrototypeCharacter?.name).toBe('Updated');
    const selectCharacter = charactersAdapter.getSelectors().selectById;
    expect(selectCharacter(payload.characters, '__proto__')?.name).toBe('Character __proto__');
  });

  it('rebuilds an EntityState input into a prototype-safe map without losing IDs', () => {
    const sourceEntities = Object.create(null) as Record<string, { id: string; name: string }>;
    sourceEntities['constructor'] = { id: 'constructor', name: 'Constructor' };
    sourceEntities['toString'] = { id: 'toString', name: 'To String' };
    const project = createDesktopProject({
      characters: { ids: ['constructor', 'toString'], entities: sourceEntities },
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload).toBeDefined();
    if (!payload) return;
    expect(payload?.characters.ids).toEqual(['constructor', 'toString']);
    expect(Object.getPrototypeOf(payload.characters.entities)).toBeNull();
    expect(payload.characters.entities['constructor']?.name).toBe('Constructor');
    expect(payload.characters.entities['toString']?.name).toBe('To String');
  });

  // QNBS-v3: orphaned entity entries must not masquerade as canonical state and suppress fresh-project fallback.
  it('rejects EntityState entries that are not represented by ids', () => {
    const project = createDesktopProject({
      characters: {
        ids: [],
        entities: { orphan: { id: 'orphan', name: 'Orphan' } },
      },
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(state)).toBe(true);
  });

  it('normalizes mixed array and EntityState desktop collections', () => {
    const world = { id: 'world-1', name: 'Arcadia' };
    const project = createDesktopProject({
      characters: [{ id: 'character-1', name: 'Ada' }],
      worlds: { ids: ['world-1'], entities: { 'world-1': world } },
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload?.characters.ids).toEqual(['character-1']);
    expect(payload?.worlds).toEqual({ ids: ['world-1'], entities: { 'world-1': world } });
  });

  it('accepts the inverse mixed EntityState and array representation', () => {
    const character = { id: 'character-1', name: 'Ada' };
    const project = createDesktopProject({
      characters: { ids: ['character-1'], entities: { 'character-1': character } },
      worlds: [{ id: 'world-1', name: 'Arcadia' }],
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;
    const payload = getPersistedProjectPayload(state.project);

    expect(payload?.characters).toEqual({
      ids: ['character-1'],
      entities: { 'character-1': character },
    });
    expect(payload?.worlds.ids).toEqual(['world-1']);
  });

  it('rejects array entities without stable IDs instead of dropping their content', () => {
    const project = createDesktopProject({ characters: [{ name: 'Missing ID' }] });
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(state)).toBe(true);
  });

  it('preserves an already canonical Redux project without changing its content', () => {
    const project = createPersistedProject({
      title: 'A story',
      logline: 'A premise',
      manuscript: [{ id: 'section-1', title: 'Chapter 1', content: 'Existing work' }],
    });
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toEqual(project);
  });

  it('keeps a structurally genuine project authoritative when title is absent', () => {
    const project = createDesktopProject({
      manuscript: [{ id: 'section-1', title: 'Existing', content: 'Work' }],
    });
    Reflect.deleteProperty(project, 'title');
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toBeDefined();
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  it('keeps a structurally genuine project authoritative when logline is absent', () => {
    const project = createDesktopProject({
      manuscript: [{ id: 'section-1', title: 'Existing', content: 'Work' }],
    });
    Reflect.deleteProperty(project, 'logline');
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toBeDefined();
    expect(shouldAllowInitialMetadataSeed(state)).toBe(false);
  });

  it('rejects a present non-array outline instead of hiding malformed structure', () => {
    const project = createDesktopProject({ outline: {} });
    const state = { project: { data: project } } as unknown as PersistedRootState;

    expect(getPersistedProjectPayload(state.project)).toBeUndefined();
    expect(shouldAllowInitialMetadataSeed(state)).toBe(true);
  });

  it('writes the normalized active payload back into an existing undo envelope', () => {
    const project = createDesktopProject({
      characters: [{ id: 'character-1', name: 'Ada' }],
      worlds: [{ id: 'world-1', name: 'Arcadia' }],
    });
    const past = [{ data: createPersistedProject({ title: 'Past' }) }];
    const future = [{ data: createPersistedProject({ title: 'Future' }) }];
    const envelope = {
      past,
      present: { data: project },
      future,
      group: 'project-edit',
      _latestUnfiltered: { data: project },
    } as unknown as PersistedRootState['project'];

    const normalized = normalizePersistedProjectForStore(envelope);

    expect(normalized?.past).toBe(past);
    expect(normalized?.future).toBe(future);
    expect(normalized?.present?.data.characters).toEqual({
      ids: ['character-1'],
      entities: { 'character-1': { id: 'character-1', name: 'Ada' } },
    });
    expect(normalized?.present?.data.outline).toEqual([]);
    expect(normalized?._latestUnfiltered).toEqual({ data: normalized?.present?.data });
  });
});
