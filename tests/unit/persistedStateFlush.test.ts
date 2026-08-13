/**
 * Tests for app/persistedStateFlush.ts
 * QNBS-v3 (#332/D3): shared flush helper used by both index.tsx's visibilitychange handler and the
 * desktop close-to-tray quit flush — verifies it saves project+settings via storageService, always
 * saves settings even with no project data yet (fresh/new-user state), and fails closed on any
 * rejected save (Promise.all, not Promise.allSettled) so a failed write is never silently ignored.
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
});
