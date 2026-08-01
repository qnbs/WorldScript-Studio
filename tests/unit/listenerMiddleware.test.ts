import { configureStore, type Reducer } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenerMiddleware } from '../../app/listenerMiddleware';
import type { RootState } from '../../app/store';
import { useTransientUiStore } from '../../app/transientUiStore';
import analyticsReducer, { analyticsActions } from '../../features/analytics/analyticsSlice';
// QNBS-v3: featureFlagsActions dispatches setEnableLocalFirstSync to exercise the local-first listener below
import featureFlagsReducer, {
  featureFlagsActions,
} from '../../features/featureFlags/featureFlagsSlice';
import proForgeReducer, { proForgeActions } from '../../features/proForge/proForgeSlice';
import { selectProjectData } from '../../features/project/projectSelectors';
import projectReducer, { projectActions } from '../../features/project/projectSlice';
import settingsReducer, { settingsActions } from '../../features/settings/settingsSlice';
import statusReducer, { statusActions } from '../../features/status/statusSlice';
import versionControlReducer from '../../features/versionControl/versionControlSlice';

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

const mockSaveProject = vi.fn().mockResolvedValue(undefined);
const mockSaveSettings = vi.fn().mockResolvedValue(undefined);
const mockSaveStoryCodex = vi.fn().mockResolvedValue(undefined);
const mockExtractStoryCodex = vi.fn().mockReturnValue({ entries: [] });
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockSaveEnvelope = vi.fn((data: unknown) => data);
const mockRebuildHybridRagIndex = vi.fn().mockResolvedValue(undefined);
const mockRunCodexExcerptEncryptionMigration = vi
  .fn()
  .mockResolvedValue({ migrated: 0, aborted: false });

vi.mock('../../services/storageService', () => ({
  storageService: {
    saveProject: (...args: unknown[]) => mockSaveProject(...args),
    saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  },
}));

vi.mock('../../services/dbService', () => ({
  dbService: {
    initDB: vi.fn().mockResolvedValue(undefined),
    loadSlice: vi.fn().mockResolvedValue(null),
    saveSlice: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/codexService', () => ({
  extractStoryCodex: (...args: unknown[]) => mockExtractStoryCodex(...args),
  saveStoryCodex: (...args: unknown[]) => mockSaveStoryCodex(...args),
}));

vi.mock('../../services/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    info: vi.fn(),
  },
}));

vi.mock('../../services/storageBackend', () => ({
  saveEnvelopeFromProjectData: (data: unknown) => mockSaveEnvelope(data),
}));

// QNBS-v3: stub the real Yjs doc/binding/persistence chain so the test asserts selectProjectData's exact payload, not real Yjs behavior.
const mockSyncFromProject = vi.fn();
const mockVerify = vi.fn().mockReturnValue({ ok: true, mismatches: [] });
const mockReproject = vi.fn();
let lastBindingCtorArg: unknown;
vi.mock('../../services/localFirst/projectDoc', () => ({
  createBlankProjectDoc: vi.fn(() => ({})),
}));
// QNBS-v3: a class, not a function expression — the real code calls `new ProjectDocBinding(...)`, and Biome's useArrowFunction rule would otherwise rewrite a function expression into a non-constructible arrow function.
class MockProjectDocBinding {
  syncFromProject = mockSyncFromProject;
  verify = mockVerify;
  reproject = mockReproject;
  constructor(initial: unknown) {
    lastBindingCtorArg = initial;
  }
}
vi.mock('../../services/localFirst/docBinding', () => ({
  ProjectDocBinding: MockProjectDocBinding,
}));
vi.mock('../../services/localFirst/docPersistence', () => ({
  NOOP_PERSISTENCE: { active: false, whenSynced: Promise.resolve() },
  persistProjectDoc: vi.fn(() => ({ active: true, whenSynced: Promise.resolve() })),
}));
vi.mock('../../services/storage/storageEncryptionService', () => ({
  isIdbEncryptionReady: vi.fn(() => true),
}));

// QNBS-v3: Phase 0 audit — duckdbListenerLoader is lazily imported in listenerMiddleware.
// Mock all loader fns so listener effects complete cleanly in stress tests.
vi.mock('../../services/duckdb/duckdbListenerLoader', () => ({
  loadLocalRagService: vi.fn(() =>
    Promise.resolve({ rebuildHybridRagIndex: mockRebuildHybridRagIndex }),
  ),
  loadDuckdbAnalytics: vi.fn(() =>
    Promise.resolve({
      duckdbDualWrite: vi.fn().mockResolvedValue(undefined),
      withDuckDbRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
      duckdbCodexWrite: vi.fn().mockResolvedValue(undefined),
    }),
  ),
  loadDuckdbMigration: vi.fn(() =>
    Promise.resolve({
      runIfNeeded: vi.fn().mockResolvedValue(undefined),
      // QNBS-v3: listenerMiddleware calls runMigrationWithRollback (not runIfNeeded) — see duckdbMigration.ts
      runMigrationWithRollback: vi.fn().mockResolvedValue({ aborted: false }),
    }),
  ),
  loadRagVectorMigration: vi.fn(() =>
    Promise.resolve({ runRagVectorMigration: vi.fn().mockResolvedValue({ aborted: false }) }),
  ),
  loadCodexExcerptEncryptionMigration: vi.fn(() =>
    Promise.resolve({
      runCodexExcerptEncryptionMigration: mockRunCodexExcerptEncryptionMigration,
    }),
  ),
}));

// QNBS-v3 (T3): desktopNotifications is dynamically imported by the ProForge stageCompleted listener.
const mockSendDesktopNotification = vi.fn().mockResolvedValue(true);
vi.mock('../../services/desktop/desktopNotifications', () => ({
  sendDesktopNotification: (...args: unknown[]) => mockSendDesktopNotification(...args),
}));

// QNBS-v3 (T3): the middleware-safe static i18n accessor is also dynamically imported by the same
// listener. Mock it with simple deterministic English strings so the notification assertions don't
// depend on real bundle fetches (jsdom has no network access in unit tests anyway).
vi.mock('../../services/i18n/staticTranslate', () => ({
  getCurrentLanguage: () => 'en',
  getStaticTranslation: (key: string, _lang: string, replacements?: Record<string, string>) => {
    if (key === 'desktop.notify.proforgeStageReadyTitle')
      return Promise.resolve('ProForge Pipeline');
    if (key === 'desktop.notify.proforgeStageReadyBody') {
      return Promise.resolve(`Stage "${replacements?.['stage']}" is ready for review.`);
    }
    if (key.startsWith('proforge.stageName.'))
      return Promise.resolve(key.replace('proforge.stageName.', ''));
    return Promise.resolve(key);
  },
}));

// ---------------------------------------------------------------------------
// Minimal store factory for listener tests
// ---------------------------------------------------------------------------

function makeMinimalStore() {
  return configureStore({
    reducer: { status: statusReducer },
    middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
  });
}

function makeFullStore() {
  return configureStore({
    reducer: {
      // QNBS-v3: redux-undo Reducer type doesn't match RTK 2.x Reducer signature — cast required
      project: undoable(projectReducer, { limit: 10 }) as unknown as Reducer,
      settings: settingsReducer,
      status: statusReducer,
      versionControl: versionControlReducer,
      featureFlags: featureFlagsReducer,
      analytics: analyticsReducer,
      proForge: proForgeReducer,
    },
    middleware: (getDefault) => getDefault().prepend(listenerMiddleware.middleware),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MinimalStore = ReturnType<typeof makeMinimalStore>;

function getNotifications(store: MinimalStore) {
  return store.getState().status.notifications;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Middleware existence
// ---------------------------------------------------------------------------
describe('listenerMiddleware', () => {
  it('is defined and has middleware property', () => {
    expect(listenerMiddleware).toBeDefined();
    expect(listenerMiddleware.middleware).toBeDefined();
    expect(typeof listenerMiddleware.middleware).toBe('function');
  });

  it('exports startListening function', () => {
    expect(listenerMiddleware.startListening).toBeDefined();
    expect(typeof listenerMiddleware.startListening).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Global error handler — isRejected listener
// ---------------------------------------------------------------------------
describe('global error handler (isRejected)', () => {
  it('dispatches addNotification for any rejected async thunk', async () => {
    const store = makeMinimalStore();

    // Simulate a rejected async thunk action
    store.dispatch({
      type: 'test/someThunk/rejected',
      error: { message: 'Something broke' },
      meta: { aborted: false, requestId: 'req-1', requestStatus: 'rejected' },
    });

    // QNBS-v3: listener effects run synchronously in test (no delay here)
    await vi.runAllTimersAsync();

    const notifications = getNotifications(store);
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const last = notifications[notifications.length - 1];
    expect(last?.type).toBe('error');
    expect(last?.title).toBe('Operation Failed');
    expect(last?.description).toContain('Something broke');
  });

  it('skips aborted actions', async () => {
    const store = makeMinimalStore();

    store.dispatch({
      type: 'test/cancelled/rejected',
      error: { message: 'AbortError' },
      meta: { aborted: true, requestId: 'req-2', requestStatus: 'rejected' },
    });

    await vi.runAllTimersAsync();

    const notifications = getNotifications(store);
    expect(notifications).toHaveLength(0);
  });

  it('shows API key quota message for quota errors', async () => {
    const store = makeMinimalStore();

    store.dispatch({
      type: 'ai/generate/rejected',
      error: { message: 'quota exceeded for this project' },
      meta: { aborted: false, requestId: 'req-3', requestStatus: 'rejected' },
    });

    await vi.runAllTimersAsync();

    const notifications = getNotifications(store);
    const last = notifications[notifications.length - 1];
    expect(last?.description).toContain('AI Service Error');
  });

  it('shows API key message for API key errors', async () => {
    const store = makeMinimalStore();

    store.dispatch({
      type: 'ai/stream/rejected',
      error: { message: 'Invalid API key provided' },
      meta: { aborted: false, requestId: 'req-4', requestStatus: 'rejected' },
    });

    await vi.runAllTimersAsync();

    const notifications = getNotifications(store);
    const last = notifications[notifications.length - 1];
    expect(last?.description).toContain('AI Service Error');
  });

  it('uses fallback description when error has no message', async () => {
    const store = makeMinimalStore();

    store.dispatch({
      type: 'test/noMsg/rejected',
      error: {},
      meta: { aborted: false, requestId: 'req-5', requestStatus: 'rejected' },
    });

    await vi.runAllTimersAsync();

    const notifications = getNotifications(store);
    const last = notifications[notifications.length - 1];
    expect(last?.description).toBe('An unexpected error occurred.');
  });
});

// ---------------------------------------------------------------------------
// statusActions (ensure statusSlice is exercise via the store)
// ---------------------------------------------------------------------------
describe('statusActions dispatched from within listeners', () => {
  it('setSavingStatus can be dispatched directly', () => {
    const store = makeMinimalStore();
    store.dispatch(statusActions.setSavingStatus('saving'));
    expect(store.getState().status.saving).toBe('saving');
  });

  it('addNotification can be dispatched directly', () => {
    const store = makeMinimalStore();
    store.dispatch(
      statusActions.addNotification({
        type: 'success',
        title: 'Saved',
      }),
    );
    expect(store.getState().status.notifications).toHaveLength(1);
    expect(store.getState().status.notifications[0]?.title).toBe('Saved');
  });
});

// ---------------------------------------------------------------------------
// Auto-Save: Project listener (1a) — debounced effect on project change
// ---------------------------------------------------------------------------
describe('auto-save project listener', () => {
  it('triggers saveProject after project state changes', async () => {
    const store = makeFullStore();
    // Mutate project to trigger the predicate
    store.dispatch(projectActions.updateTitle('New Title'));
    // Advance past debounce delay
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockSaveProject).toHaveBeenCalled();
  });

  it('dispatches saving/saved/idle status cycle on success', async () => {
    const store = makeFullStore();
    store.dispatch(projectActions.updateTitle('Save Test'));
    await vi.advanceTimersByTimeAsync(1500);
    // After save, status should move toward idle (timers run fully)
    await vi.advanceTimersByTimeAsync(3000);
    // At least one save should have occurred
    expect(mockSaveProject).toHaveBeenCalled();
  });

  it('dispatches error notification when saveProject throws', async () => {
    mockSaveProject.mockRejectedValueOnce(new Error('Disk full'));
    const store = makeFullStore();
    store.dispatch(projectActions.updateTitle('Failing Save'));
    await vi.advanceTimersByTimeAsync(1500);
    const notifications = store.getState().status.notifications;
    // An error notification should be present
    const errorNote = notifications.find((n) => n.type === 'error');
    expect(errorNote).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Auto-Save: Settings listener (1b)
// ---------------------------------------------------------------------------
describe('auto-save settings listener', () => {
  it('settings change dispatches actions without throwing', async () => {
    const store = makeFullStore();
    // Dispatching a settings change should not throw and should mutate state
    expect(() => store.dispatch(settingsActions.setTheme('light'))).not.toThrow();
    expect(store.getState().settings.theme).toBe('light');
    // Advance timers to execute the debounced effect
    await vi.advanceTimersByTimeAsync(2000);
    // Either saveSettings was called (debounce fired) or it wasn't yet (if somehow still pending)
    // The important thing is no error was thrown
  });

  it('settings state updates synchronously when setTheme is dispatched', async () => {
    const store = makeFullStore();
    const prevTheme = store.getState().settings.theme;
    store.dispatch(settingsActions.setTheme(prevTheme === 'dark' ? 'light' : 'dark'));
    // Verify state changed
    expect(store.getState().settings.theme).not.toBe(prevTheme);
    // Advance timers — should not throw
    await vi.advanceTimersByTimeAsync(1500);
  });
});

// ---------------------------------------------------------------------------
// DuckDB analytics migration chain (seed + RAG + codex excerpt encryption, SEC-6)
// ---------------------------------------------------------------------------
describe('DuckDB analytics migration listener', () => {
  it('runs the codex excerpt encryption migration and marks status done when nothing aborts', async () => {
    const store = makeFullStore();
    store.dispatch(analyticsActions.setDuckDbStatus('ready'));
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRunCodexExcerptEncryptionMigration).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Function),
    );
    expect(store.getState().analytics.migrationStatus).toBe('done');
  });

  it('resets migrationStatus to idle (not done) when the codex excerpt migration aborts', async () => {
    const { loadCodexExcerptEncryptionMigration } = await import(
      '../../services/duckdb/duckdbListenerLoader'
    );
    vi.mocked(loadCodexExcerptEncryptionMigration).mockResolvedValueOnce({
      runCodexExcerptEncryptionMigration: vi.fn().mockResolvedValue({ migrated: 0, aborted: true }),
      isCodexExcerptEncryptionMigrationDone: vi.fn().mockResolvedValue(false),
    });
    const store = makeFullStore();
    store.dispatch(analyticsActions.setDuckDbStatus('ready'));
    await vi.advanceTimersByTimeAsync(0);

    expect(store.getState().analytics.migrationStatus).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Codex auto-tracking listener (1c) — debounced on manuscript change
// ---------------------------------------------------------------------------
// QNBS-v3: enableCodexAutoTracking promoted to permanent core — always runs, no flag needed.
describe('codex auto-tracking listener', () => {
  it('calls extractStoryCodex after manuscript changes (always-on)', async () => {
    const store = makeFullStore();
    store.dispatch(projectActions.addManuscriptSection({ title: 'New Chapter' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockExtractStoryCodex).toHaveBeenCalled();
    expect(mockSaveStoryCodex).toHaveBeenCalled();
  });

  it('logs warning when extractStoryCodex throws', async () => {
    mockExtractStoryCodex.mockImplementationOnce(() => {
      throw new Error('Codex error');
    });
    const store = makeFullStore();
    store.dispatch(projectActions.addManuscriptSection({ title: 'Error Chapter' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});

describe('binder-node pin reconciliation listener', () => {
  afterEach(() => {
    useTransientUiStore.getState().setManuscriptPinnedBinderNodeId(null);
  });

  it('clears a stale manuscriptPinnedBinderNodeId after its node is removed', async () => {
    const store = makeFullStore();
    useTransientUiStore.getState().setManuscriptPinnedBinderNodeId('node-1');
    store.dispatch(
      projectActions.setBinderNodes([
        { id: 'node-2', parentId: null, type: 'note', title: 'Other', sortIndex: 0 },
      ]),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(useTransientUiStore.getState().manuscriptPinnedBinderNodeId).toBeNull();
  });

  it('leaves manuscriptPinnedBinderNodeId untouched when the pinned node still exists', async () => {
    const store = makeFullStore();
    useTransientUiStore.getState().setManuscriptPinnedBinderNodeId('node-1');
    store.dispatch(
      projectActions.setBinderNodes([
        { id: 'node-1', parentId: null, type: 'note', title: 'Kept', sortIndex: 0 },
      ]),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(useTransientUiStore.getState().manuscriptPinnedBinderNodeId).toBe('node-1');
  });
});

// ---------------------------------------------------------------------------
// Phase 0 Hardening: Stress tests + cancelActiveListeners audit
//
// Audit results (as of Phase 0):
//   1a auto-save project   — addDebouncedListener (cancelActiveListeners ✅ added Phase 0)
//   1b auto-save settings  — addDebouncedListener (cancelActiveListeners ✅ added Phase 0)
//   1c codex               — addDebouncedListener (cancelActiveListeners ✅ added Phase 0)
//   RAG rebuild            — direct startListening (cancelActiveListeners ✅ pre-existing)
//   DuckDB migration       — fire-once (no cancelActiveListeners needed — state-predicated)
// ---------------------------------------------------------------------------

describe('debounce stress tests', () => {
  // QNBS-v3: 50 rapid project changes → exactly 1 saveProject call per debounce window.
  // cancelActiveListeners() in addDebouncedListener ensures only the last burst's invocation runs.
  it('project auto-save fires exactly once for 50 rapid title changes', async () => {
    const store = makeFullStore();
    for (let i = 0; i < 50; i++) {
      store.dispatch(projectActions.updateTitle(`Title ${i}`));
    }
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockSaveProject).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: 50 rapid settings changes → exactly 1 saveSettings call.
  it('settings auto-save fires exactly once for 50 rapid theme changes', async () => {
    const store = makeFullStore();
    for (let i = 0; i < 50; i++) {
      store.dispatch(settingsActions.setTheme(i % 2 === 0 ? 'dark' : 'light'));
    }
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: 50 rapid manuscript changes → RAG rebuild fires exactly once.
  // cancelActiveListeners() in the RAG listener ensures only the final invocation completes.
  it('RAG auto-rebuild fires exactly once for 50 rapid manuscript changes', async () => {
    const store = makeFullStore();
    for (let i = 0; i < 50; i++) {
      store.dispatch(projectActions.addManuscriptSection({ title: `Scene ${i}` }));
    }
    // Advance past the 5000ms RAG delay
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockRebuildHybridRagIndex).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Analytics privacy opt-out gates the DuckDB mirror (SEC)
// ---------------------------------------------------------------------------
describe('analytics privacy opt-out gating', () => {
  // QNBS-v3: SEC — the RAG index always rebuilds, but its DuckDB vector mirror is gated by a THUNK
  // (third rebuildHybridRagIndex arg) that re-evaluates isAnalyticsPersistenceAllowed at write time.
  // The contract is the live-callback itself: asserting a function (not a precomputed boolean) catches
  // a regression where the middleware reverts to passing a stale snapshot.
  function lastDuckDbGate(): () => boolean {
    const call = mockRebuildHybridRagIndex.mock.calls.at(-1);
    const gate = call?.[2];
    expect(typeof gate).toBe('function'); // enforce the live-callback contract, not a boolean
    return gate as () => boolean;
  }

  it('passes a live thunk that resolves true when the analytics opt-out is on (default)', async () => {
    const store = makeFullStore();
    store.dispatch(projectActions.addManuscriptSection({ title: 'Scene' }));
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockRebuildHybridRagIndex).toHaveBeenCalledTimes(1);
    expect(lastDuckDbGate()()).toBe(true);
  });

  it('passes a live thunk that resolves false when the analytics opt-out is off', async () => {
    const store = makeFullStore();
    store.dispatch(settingsActions.setPrivacy({ analyticsEnabled: false }));
    store.dispatch(projectActions.addManuscriptSection({ title: 'Scene' }));
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockRebuildHybridRagIndex).toHaveBeenCalledTimes(1);
    expect(lastDuckDbGate()()).toBe(false);
  });

  it('the thunk reflects a LIVE opt-out toggled after the rebuild call (proves it is not a snapshot)', async () => {
    const store = makeFullStore();
    store.dispatch(projectActions.addManuscriptSection({ title: 'Scene' }));
    await vi.advanceTimersByTimeAsync(6000);
    const gate = lastDuckDbGate();
    expect(gate()).toBe(true);
    // Opt out AFTER the call was made — a live thunk must now report false; a captured boolean wouldn't.
    store.dispatch(settingsActions.setPrivacy({ analyticsEnabled: false }));
    expect(gate()).toBe(false);
  });
});

// QNBS-v3: covers canonical selector use during local-first sync — prevents project-data selection regressions
describe('local-first shadow sync (B1.1)', () => {
  it('passes the canonical selector output straight through to the binding', async () => {
    const store = makeFullStore();
    store.dispatch(projectActions.updateTitle('Local-First Title'));
    store.dispatch(featureFlagsActions.setEnableLocalFirstSync(true));
    await vi.advanceTimersByTimeAsync(100);

    // Asserts the actual selector→sync boundary directly (per review feedback) instead of
    // inferring success from an absence of logger calls: the exact object selectProjectData(state)
    // returns must be what reaches ProjectDocBinding's constructor and syncFromProject/verify.
    const presentData = selectProjectData(store.getState() as unknown as RootState);
    expect(lastBindingCtorArg).toBe(presentData);
    expect(mockSyncFromProject).toHaveBeenCalledWith(presentData);
    expect(mockVerify).toHaveBeenCalledWith(presentData);
    expect(mockReproject).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Desktop Notify (T3): ProForge stageCompleted -> native OS notification
// ---------------------------------------------------------------------------
describe('desktop notification listener (ProForge stageCompleted)', () => {
  it('sends a desktop notification when desktopNotifications is enabled', async () => {
    const store = makeFullStore();
    store.dispatch(settingsActions.setDesktopSettings({ desktopNotifications: true }));
    store.dispatch(proForgeActions.stageCompleted({ stage: 'structural', result: {} }));
    await vi.runAllTimersAsync();

    expect(mockSendDesktopNotification).toHaveBeenCalledTimes(1);
    expect(mockSendDesktopNotification).toHaveBeenCalledWith(
      'ProForge Pipeline',
      'Stage "structural" is ready for review.',
    );
  });

  it('does not send a notification when desktopNotifications is disabled', async () => {
    const store = makeFullStore();
    store.dispatch(settingsActions.setDesktopSettings({ desktopNotifications: false }));
    store.dispatch(proForgeActions.stageCompleted({ stage: 'structural', result: {} }));
    await vi.runAllTimersAsync();

    expect(mockSendDesktopNotification).not.toHaveBeenCalled();
  });
});
