import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShortcutRuntimeApi } from '../../../services/keyboard/shortcutActions';
import {
  findMatchingShortcutAction,
  performShortcutAction,
} from '../../../services/keyboard/shortcutActions';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPersistProjectAutosaveSnapshot = vi.fn().mockResolvedValue(undefined);
const mockPersistenceResult = { superseded: false };

vi.mock('../../../app/persistenceCoordinator', () => ({
  projectPersistenceCoordinator: {
    enqueue: (operation: () => Promise<void>) => operation().then(() => mockPersistenceResult),
  },
}));

vi.mock('../../../services/projectAutosavePersistence', () => ({
  persistProjectAutosaveSnapshot: (...a: unknown[]) => mockPersistProjectAutosaveSnapshot(...a),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: { saveProject: vi.fn() },
}));

vi.mock('../../../services/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  // QNBS-v3: routingLogger.ts (pulled in transitively via aiThunkUtils.ts's policy pre-check) calls createLogger() and sanitizeLogContext() at module scope, so this mock must cover both or the import throws.
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  sanitizeLogContext: (ctx: unknown) => ctx,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    key: 'a',
    ...overrides,
  });
}

function makeApi(overrides: Partial<ShortcutRuntimeApi> = {}): ShortcutRuntimeApi {
  const defaultState = {
    settings: { theme: 'light' },
    project: { present: { data: { id: 'p1', title: 'My Novel', manuscript: [] } } },
    versionControl: { branches: [], snapshots: [], currentBranchId: null },
    status: { saving: 'idle' },
  };
  return {
    dispatch: vi.fn(),
    getState: vi.fn(() => defaultState) as unknown as ShortcutRuntimeApi['getState'],
    navigate: vi.fn(),
    togglePalette: vi.fn(),
    translate: ((key: string) => key) as ShortcutRuntimeApi['translate'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPersistProjectAutosaveSnapshot.mockResolvedValue(undefined);
  mockPersistenceResult.superseded = false;
});

// ---------------------------------------------------------------------------
// findMatchingShortcutAction
// ---------------------------------------------------------------------------
describe('findMatchingShortcutAction', () => {
  const shortcuts = [
    { keys: ['Ctrl', 'S'], action: 'save' },
    { keys: ['Ctrl', 'K'], action: 'openCommandPalette' },
    { keys: ['Escape'], action: 'close' },
  ];

  it('returns the action when a shortcut matches', () => {
    const e = makeEvent({ ctrlKey: true, key: 's' });
    expect(findMatchingShortcutAction(e, shortcuts)).toBe('save');
  });

  it('returns undefined when no shortcut matches', () => {
    const e = makeEvent({ key: 'x' });
    expect(findMatchingShortcutAction(e, shortcuts)).toBeUndefined();
  });

  it('returns the first matching action when multiple could match', () => {
    const e = makeEvent({ ctrlKey: true, key: 'k' });
    expect(findMatchingShortcutAction(e, shortcuts)).toBe('openCommandPalette');
  });

  it('returns undefined for empty shortcuts list', () => {
    const e = makeEvent({ ctrlKey: true, key: 's' });
    expect(findMatchingShortcutAction(e, [])).toBeUndefined();
  });

  it('matches Escape action', () => {
    const e = makeEvent({ key: 'Escape' });
    expect(findMatchingShortcutAction(e, shortcuts)).toBe('close');
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — openCommandPalette
// ---------------------------------------------------------------------------
describe('performShortcutAction — openCommandPalette', () => {
  it('calls togglePalette', async () => {
    const api = makeApi();
    await performShortcutAction('openCommandPalette', api);
    expect(api.togglePalette).toHaveBeenCalled();
  });

  it('does not call dispatch', async () => {
    const api = makeApi();
    await performShortcutAction('openCommandPalette', api);
    expect(api.dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — newSection
// ---------------------------------------------------------------------------
describe('performShortcutAction — newSection', () => {
  it('dispatches addManuscriptSection', async () => {
    const api = makeApi();
    await performShortcutAction('newSection', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addManuscriptSection' }),
    );
  });

  it('navigates to manuscript', async () => {
    const api = makeApi();
    await performShortcutAction('newSection', api);
    expect(api.navigate).toHaveBeenCalledWith('manuscript');
  });

  it('dispatches a success notification', async () => {
    const api = makeApi();
    await performShortcutAction('newSection', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — search
// ---------------------------------------------------------------------------
describe('performShortcutAction — search', () => {
  it('navigates to manuscript', async () => {
    const api = makeApi();
    await performShortcutAction('search', api);
    expect(api.navigate).toHaveBeenCalledWith('manuscript');
  });

  it('dispatches an info notification', async () => {
    const api = makeApi();
    await performShortcutAction('search', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/addNotification' }),
    );
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — export
// ---------------------------------------------------------------------------
describe('performShortcutAction — export', () => {
  it('navigates to export view', async () => {
    const api = makeApi();
    await performShortcutAction('export', api);
    expect(api.navigate).toHaveBeenCalledWith('export');
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — toggleTheme
// ---------------------------------------------------------------------------
describe('performShortcutAction — toggleTheme', () => {
  it('toggles from light to dark', async () => {
    const api = makeApi({
      getState: vi.fn(() => ({
        settings: { theme: 'light' },
        project: { present: { data: { title: 'Test' } } },
        versionControl: { branches: [], snapshots: [], currentBranchId: null },
        status: { saving: 'idle' },
      })) as unknown as ShortcutRuntimeApi['getState'],
    });
    // Mock matchMedia to return light scheme
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));

    await performShortcutAction('toggleTheme', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setTheme', payload: 'dark' }),
    );
  });

  it('toggles from dark to light', async () => {
    const api = makeApi({
      getState: vi.fn(() => ({
        settings: { theme: 'dark' },
        project: { present: { data: { title: 'Test' } } },
        versionControl: { branches: [], snapshots: [], currentBranchId: null },
        status: { saving: 'idle' },
      })) as unknown as ShortcutRuntimeApi['getState'],
    });

    await performShortcutAction('toggleTheme', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings/setTheme', payload: 'light' }),
    );
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — save
// ---------------------------------------------------------------------------
describe('performShortcutAction — save', () => {
  it('routes the save through the coordinated project persistence service', async () => {
    const api = makeApi();
    await performShortcutAction('save', api);
    expect(mockPersistProjectAutosaveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', title: 'My Novel' }),
    );
  });

  it('dispatches setSavingStatus("saved") after successful save', async () => {
    const api = makeApi();
    await performShortcutAction('save', api);
    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/setSavingStatus', payload: 'saved' }),
    );
  });

  it('clears the transient status when a newer coordinated save supersedes the manual save', async () => {
    mockPersistenceResult.superseded = true;
    const api = makeApi();

    await performShortcutAction('save', api);

    expect(api.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/setSavingStatus', payload: 'idle' }),
    );
    expect(api.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status/setSavingStatus', payload: 'saved' }),
    );
    expect(api.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'status/addNotification',
        payload: expect.objectContaining({ type: 'success' }),
      }),
    );
  });

  it('dispatches error notification when save fails', async () => {
    mockPersistProjectAutosaveSnapshot.mockRejectedValue(new Error('Storage full'));
    const api = makeApi();
    await performShortcutAction('save', api);
    const errorCalls = (api.dispatch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) =>
        (c[0] as { type?: string })?.type === 'status/addNotification' &&
        (c[0] as { payload?: { type?: string } })?.payload?.type === 'error',
    );
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('dispatches error notification when no project data is present', async () => {
    const api = makeApi({
      getState: vi.fn(() => ({
        settings: { theme: 'light' },
        project: { present: { data: undefined } },
        versionControl: { branches: [], snapshots: [], currentBranchId: null },
        status: { saving: 'idle' },
      })) as unknown as ShortcutRuntimeApi['getState'],
    });
    await performShortcutAction('save', api);
    // The canonical persistence service should not be called when project data is missing.
    expect(mockPersistProjectAutosaveSnapshot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// performShortcutAction — unknown action
// ---------------------------------------------------------------------------
describe('performShortcutAction — unknown action', () => {
  it('does not throw for an unknown action', async () => {
    const api = makeApi();
    await expect(performShortcutAction('this-action-does-not-exist', api)).resolves.not.toThrow();
  });
});
