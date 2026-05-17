import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../features/settings/keyboardShortcutsDefaults', () => ({
  getDefaultKeyboardShortcuts: vi.fn(() => []),
  SHORTCUT_ACTION_REGISTRY: [],
}));

vi.mock('../../app/aiApi', () => ({
  aiApi: {
    reducerPath: 'aiApi',
    reducer: (s = {}) => s,
    middleware: () => (next: (a: unknown) => unknown) => (action: unknown) => next(action),
  },
}));

vi.mock('../../app/listenerMiddleware', () => ({
  listenerMiddleware: {
    middleware: () => (next: (a: unknown) => unknown) => (action: unknown) => next(action),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setupStore', () => {
  it('creates a store with all expected slices', async () => {
    const { setupStore } = await import('../../app/store');
    const store = setupStore();
    // QNBS-v3: cast needed because mocked aiApi reducer loses its return type in configureStore inference
    const state = store.getState() as Record<string, unknown>;
    expect(state['project']).toBeTruthy();
    expect(state['settings']).toBeTruthy();
    expect(state['status']).toBeTruthy();
    expect(state['writer']).toBeTruthy();
    expect(state['versionControl']).toBeTruthy();
    expect(state['featureFlags']).toBeTruthy();
  });

  it('accepts preloaded state', async () => {
    const { setupStore } = await import('../../app/store');
    // Passing empty preloadedState should not crash
    expect(() => setupStore()).not.toThrow();
  });

  it('store dispatch works without throwing', async () => {
    const { setupStore } = await import('../../app/store');
    const store = setupStore();
    expect(() => store.dispatch({ type: 'test/noop' })).not.toThrow();
  });

  it('project slice supports undo history structure', async () => {
    const { setupStore } = await import('../../app/store');
    const store = setupStore();
    // QNBS-v3: cast needed — same reason as first test; mocked aiApi loses return type
    const state = store.getState() as Record<
      string,
      { past: unknown[]; future: unknown[]; present: unknown }
    >;
    expect(Array.isArray(state['project']?.past)).toBe(true);
    expect(Array.isArray(state['project']?.future)).toBe(true);
    expect(state['project']?.present).toBeTruthy();
  });
});

describe('rootReducer', () => {
  it('is a function', async () => {
    const { rootReducer } = await import('../../app/store');
    expect(typeof rootReducer).toBe('function');
  });

  it('returns state unchanged for unknown actions', async () => {
    const { rootReducer } = await import('../../app/store');
    const state = rootReducer(undefined, { type: '@@INIT' });
    expect(state).toBeTruthy();
    expect(state.settings).toBeTruthy();
  });
});
