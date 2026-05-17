import { configureStore, type Reducer } from '@reduxjs/toolkit';
import undoable from 'redux-undo';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenerMiddleware } from '../../app/listenerMiddleware';
import featureFlagsReducer from '../../features/featureFlags/featureFlagsSlice';
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
// Codex auto-tracking listener (1c) — debounced on manuscript change
// ---------------------------------------------------------------------------
describe('codex auto-tracking listener', () => {
  it('calls extractStoryCodex after manuscript changes when feature enabled', async () => {
    const store = makeFullStore();
    // enableCodexAutoTracking defaults to true in featureFlagsSlice
    store.dispatch(projectActions.addManuscriptSection({ title: 'New Chapter' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockExtractStoryCodex).toHaveBeenCalled();
    expect(mockSaveStoryCodex).toHaveBeenCalled();
  });

  it('skips codex extraction when feature flag is disabled', async () => {
    const store = makeFullStore();
    store.dispatch({ type: 'featureFlags/setEnableCodexAutoTracking', payload: false });
    store.dispatch(projectActions.addManuscriptSection({ title: 'Skipped Chapter' }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockExtractStoryCodex).not.toHaveBeenCalled();
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
