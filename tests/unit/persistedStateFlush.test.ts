/**
 * Tests for app/persistedStateFlush.ts
 * QNBS-v3 (#332/D3): shared flush helper used by both index.tsx's visibilitychange handler and the
 * desktop close-to-tray quit flush — verifies it saves project+settings via storageService, always
 * saves settings even with no project data yet (fresh/new-user state), and fails closed on any
 * rejected save (Promise.allSettled, waiting for both to settle before rejecting) so a failed
 * write is never silently ignored and a caller that reloads immediately after never tears down
 * the page while the other save is still in flight.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../app/store';

const h = vi.hoisted(() => ({
  persistProjectAutosaveSnapshot: vi.fn(async (_snapshot: unknown) => {}),
  saveSettings: vi.fn(async (_settings: unknown) => {}),
  isFactoryResetInProgress: vi.fn(() => false),
}));

vi.mock('../../services/storageService', () => ({
  storageService: { saveSettings: h.saveSettings },
}));

vi.mock('../../services/projectAutosavePersistence', () => ({
  persistProjectAutosaveSnapshot: (snapshot: unknown) => h.persistProjectAutosaveSnapshot(snapshot),
}));

vi.mock('../../services/factoryResetService', () => ({
  isFactoryResetInProgress: () => h.isFactoryResetInProgress(),
}));

import { flushPersistedState } from '../../app/persistedStateFlush';
import {
  projectPersistenceCoordinator,
  settingsPersistenceCoordinator,
} from '../../app/persistenceCoordinator';
import {
  _resetSafeSessionForTest,
  enterSafeSession,
  establishSafeSessionProject,
} from '../../services/startupSafeSession';

function buildState(overrides: Partial<RootState> = {}): RootState {
  return {
    project: {
      present: {
        data: {
          id: 'proj-1',
          title: 'My Project',
        },
      },
    },
    versionControl: {
      branches: [{ id: 'main' }],
      snapshots: [],
      currentBranchId: 'main',
    },
    settings: { theme: 'dark' },
    ...overrides,
  } as unknown as RootState;
}

describe('flushPersistedState', () => {
  beforeEach(() => {
    h.persistProjectAutosaveSnapshot.mockClear();
    h.saveSettings.mockClear();
    h.isFactoryResetInProgress.mockReturnValue(false);
    _resetSafeSessionForTest();
  });

  // QNBS-v3: quitApp aborts on any flush rejection, so a safe-session fence must skip the project (settings still flush) rather than reject and strand the window.
  it('skips the fenced safe-session project without rejecting, while settings still flush', async () => {
    enterSafeSession('refused-dir');
    const state = buildState();

    await expect(flushPersistedState(state)).resolves.toBeUndefined();

    expect(h.persistProjectAutosaveSnapshot).not.toHaveBeenCalled();
    expect(h.saveSettings).toHaveBeenCalledWith(state.settings);
  });

  it('persists only a session-established identity and never the refused one', async () => {
    enterSafeSession('proj-1');
    await flushPersistedState(buildState());
    expect(h.persistProjectAutosaveSnapshot).not.toHaveBeenCalled();

    let minted = '';
    establishSafeSessionProject('proj-1', (projectId) => {
      minted = projectId;
    });
    await flushPersistedState(buildState());
    expect(h.persistProjectAutosaveSnapshot).not.toHaveBeenCalled();

    await flushPersistedState(
      buildState({
        project: {
          present: { data: { id: minted, title: 'New' } },
        } as unknown as RootState['project'],
      }),
    );
    expect(h.persistProjectAutosaveSnapshot).toHaveBeenCalledTimes(1);
  });

  // QNBS-v3: window.location.reload() fires visibilitychange before the page actually unloads -- a factory reset's own reload must not race this flush into recreating the just-deleted database.
  it('skips the flush entirely while a factory reset is in progress', async () => {
    h.isFactoryResetInProgress.mockReturnValue(true);
    await flushPersistedState(buildState());
    expect(h.persistProjectAutosaveSnapshot).not.toHaveBeenCalled();
    expect(h.saveSettings).not.toHaveBeenCalled();
  });

  it('saves project (enriched with persistedVersionControl) and settings', async () => {
    const state = buildState();
    await flushPersistedState(state);

    expect(h.persistProjectAutosaveSnapshot).toHaveBeenCalledTimes(1);
    const [savedArg] = h.persistProjectAutosaveSnapshot.mock.calls[0] ?? [];
    expect(savedArg && typeof savedArg === 'object' && 'id' in savedArg && savedArg.id).toBe(
      'proj-1',
    );
    expect(
      savedArg &&
        typeof savedArg === 'object' &&
        'persistedVersionControl' in savedArg &&
        savedArg.persistedVersionControl,
    ).toEqual({
      branches: [{ id: 'main' }],
      snapshots: [],
      currentBranchId: 'main',
    });

    expect(h.saveSettings).toHaveBeenCalledWith(state.settings);
  });

  it('still saves settings when there is no project data yet (fresh/new-user state)', async () => {
    const state = buildState({
      project: { present: { data: undefined } } as unknown as RootState['project'],
    });
    await flushPersistedState(state);
    expect(h.persistProjectAutosaveSnapshot).not.toHaveBeenCalled();
    expect(h.saveSettings).toHaveBeenCalledWith(state.settings);
  });

  it('propagates a rejection when canonical autosave fails (fail-closed, not swallowed)', async () => {
    h.persistProjectAutosaveSnapshot.mockRejectedValueOnce(new Error('disk full'));
    await expect(flushPersistedState(buildState())).rejects.toThrow('disk full');
  });

  // QNBS-v3 (#553): the coordinator resolves (not rejects) a waiter whose own failed attempt had a queued successor; a quit flush must not read that as "saved", or it could skip the stale-writer discard consent.
  it('rejects with the chain’s final failure when its own attempt was superseded', async () => {
    let failOwnAttempt: (error: Error) => void = () => {};
    h.persistProjectAutosaveSnapshot.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOwnAttempt = reject;
        }),
    );

    const flushPromise = flushPersistedState(buildState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const successor = projectPersistenceCoordinator
      .enqueue(() => Promise.reject(new Error('successor refused')))
      .catch(() => undefined);
    failOwnAttempt(new Error('own attempt refused'));

    await expect(flushPromise).rejects.toThrow('successor refused');
    await successor;
    // QNBS-v3: never replays the flush's own older snapshot — only its single original attempt ran.
    expect(h.persistProjectAutosaveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('resolves when a newer queued save succeeded after its own attempt was superseded', async () => {
    let failOwnAttempt: (error: Error) => void = () => {};
    h.persistProjectAutosaveSnapshot.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOwnAttempt = reject;
        }),
    );

    const flushPromise = flushPersistedState(buildState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const successor = projectPersistenceCoordinator.enqueue(async () => {});
    failOwnAttempt(new Error('own attempt refused'));

    await expect(flushPromise).resolves.toBeUndefined();
    await successor;
    expect(h.persistProjectAutosaveSnapshot).toHaveBeenCalledTimes(1);
  });

  it('applies the same fail-closed rule to a superseded settings save', async () => {
    let failOwnAttempt: (error: Error) => void = () => {};
    h.saveSettings.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failOwnAttempt = reject;
        }),
    );

    const flushPromise = flushPersistedState(buildState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const successor = settingsPersistenceCoordinator
      .enqueue(() => Promise.reject(new Error('settings successor refused')))
      .catch(() => undefined);
    failOwnAttempt(new Error('own settings attempt refused'));

    await expect(flushPromise).rejects.toThrow('settings successor refused');
    await successor;
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection when saveSettings fails (fail-closed, not swallowed)', async () => {
    h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    await expect(flushPersistedState(buildState())).rejects.toThrow('disk full');
  });

  // QNBS-v3: an immediate-reload caller must never tear down the page while the other save is still in flight.
  it('waits for the other save to settle before rejecting, instead of rejecting as soon as one fails', async () => {
    const order: string[] = [];
    h.persistProjectAutosaveSnapshot.mockImplementation(async () => {
      order.push('project-rejected');
      throw new Error('project save failed');
    });
    let resolveSettings: () => void = () => {};
    h.saveSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSettings = () => {
            order.push('settings-resolved');
            resolve();
          };
        }),
    );

    const flushPromise = flushPersistedState(buildState()).catch((err: unknown) => {
      order.push('flush-rejected');
      throw err;
    });

    // QNBS-v3: a macrotask boundary drains every microtask the real coordinator's drain loop schedules, however many ticks deep.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['project-rejected']);

    resolveSettings();
    await expect(flushPromise).rejects.toThrow('project save failed');
    expect(order).toEqual(['project-rejected', 'settings-resolved', 'flush-rejected']);
  });
});
