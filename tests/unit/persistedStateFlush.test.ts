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
  saveProject: vi.fn(async (_envelope: { envelope: Record<string, unknown> }) => {}),
  saveSettings: vi.fn(async (_settings: unknown) => {}),
}));

vi.mock('../../services/storageService', () => ({
  storageService: { saveProject: h.saveProject, saveSettings: h.saveSettings },
  saveEnvelopeFromProjectData: (data: unknown) => ({ envelope: data }),
}));

import { flushPersistedState } from '../../app/persistedStateFlush';

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
    h.saveProject.mockClear();
    h.saveSettings.mockClear();
  });

  it('saves project (enriched with persistedVersionControl) and settings', async () => {
    const state = buildState();
    await flushPersistedState(state);

    expect(h.saveProject).toHaveBeenCalledTimes(1);
    const [savedArg] = h.saveProject.mock.calls[0] ?? [];
    expect(savedArg?.envelope['id']).toBe('proj-1');
    expect(savedArg?.envelope['persistedVersionControl']).toEqual({
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
    expect(h.saveProject).not.toHaveBeenCalled();
    expect(h.saveSettings).toHaveBeenCalledWith(state.settings);
  });

  it('propagates a rejection when saveProject fails (fail-closed, not swallowed)', async () => {
    h.saveProject.mockRejectedValueOnce(new Error('disk full'));
    await expect(flushPersistedState(buildState())).rejects.toThrow('disk full');
  });

  it('propagates a rejection when saveSettings fails (fail-closed, not swallowed)', async () => {
    h.saveSettings.mockRejectedValueOnce(new Error('disk full'));
    await expect(flushPersistedState(buildState())).rejects.toThrow('disk full');
  });

  // QNBS-v3: an immediate-reload caller must never tear down the page while the other save is still in flight.
  it('waits for the other save to settle before rejecting, instead of rejecting as soon as one fails', async () => {
    const order: string[] = [];
    h.saveProject.mockImplementation(async () => {
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
