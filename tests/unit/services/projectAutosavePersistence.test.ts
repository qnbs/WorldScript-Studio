import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../features/project/projectSlice';

const h = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  projectAuthority: vi.fn((): 'fs' | 'idb' | undefined => undefined),
  saveProject: vi.fn(async (_project: unknown, _options?: unknown) => {}),
  saveAutosaveSnapshotCanonical: vi.fn(
    async (
      _snapshot: unknown,
      _options?: unknown,
    ): Promise<{ status: string; generation?: string; reason?: string }> => ({
      status: 'SAVED',
      generation: 'generation-1',
    }),
  ),
}));

vi.mock('../../../services/tauriRuntime', () => ({
  isTauriRuntime: () => h.isTauriRuntime(),
}));

vi.mock('../../../services/storageBackend', () => ({
  saveEnvelopeFromProjectData: (data: unknown) => ({ data }),
}));

vi.mock('../../../services/storageService', () => ({
  storageService: {
    saveProject: (project: unknown, options?: unknown) => h.saveProject(project, options),
    getProjectAuthority: async () => h.projectAuthority() ?? (h.isTauriRuntime() ? 'fs' : 'idb'),
  },
}));

vi.mock('../../../services/projectAutosaveCanonicalWriter', () => ({
  saveAutosaveSnapshotCanonical: (snapshot: unknown, _authority: unknown, options?: unknown) =>
    h.saveAutosaveSnapshotCanonical(snapshot, options),
  assertCanonicalAutosaveSucceeded: (result: { status: string }) => {
    if (!['SAVED', 'CREATED', 'MIGRATED_AND_SAVED'].includes(result.status)) {
      throw new Error(`Canonical autosave did not commit (${result.status})`);
    }
  },
}));

import {
  _resetEditorProjectGenerationForTest,
  isReplacementPending,
  toEditorReplacementEpoch,
} from '../../../services/editorProjectGeneration';
import { StaleProjectWriterError } from '../../../services/fs/fsCore';
import { persistProjectAutosaveSnapshot } from '../../../services/projectAutosavePersistence';

const snapshot = { id: 'project-1', title: 'A Project' } as ProjectData;

describe('persistProjectAutosaveSnapshot', () => {
  beforeEach(() => {
    h.isTauriRuntime.mockReturnValue(false);
    h.saveProject.mockClear();
    h.saveAutosaveSnapshotCanonical.mockClear();
    _resetEditorProjectGenerationForTest();
  });

  it('routes web autosave through the canonical writer', async () => {
    await persistProjectAutosaveSnapshot(snapshot);

    expect(h.saveAutosaveSnapshotCanonical).toHaveBeenCalledWith(snapshot, { replacement: false });
    expect(h.saveProject).not.toHaveBeenCalled();
  });

  it('preserves the filesystem backend for desktop autosave', async () => {
    h.isTauriRuntime.mockReturnValue(true);

    await persistProjectAutosaveSnapshot(snapshot);

    expect(h.saveProject).toHaveBeenCalledWith({ data: snapshot }, { replacement: false });
    expect(h.saveAutosaveSnapshotCanonical).not.toHaveBeenCalled();
  });

  it('does not fall back to the legacy backend when canonical admission fails', async () => {
    h.saveAutosaveSnapshotCanonical.mockResolvedValueOnce({
      status: 'REFUSED',
      reason: 'FUTURE',
    });

    await expect(persistProjectAutosaveSnapshot(snapshot)).rejects.toThrow(
      'Canonical autosave did not commit (REFUSED)',
    );
    expect(h.saveProject).not.toHaveBeenCalled();
  });
});

describe('persistProjectAutosaveSnapshot replacement baseline (#553 a10)', () => {
  const epoch = toEditorReplacementEpoch;
  const replacementFlags = () =>
    h.saveAutosaveSnapshotCanonical.mock.calls.map(
      (call) => (call[1] as { replacement: boolean }).replacement,
    );

  beforeEach(() => {
    h.isTauriRuntime.mockReturnValue(false);
    h.saveProject.mockReset();
    h.saveAutosaveSnapshotCanonical.mockReset();
    h.saveAutosaveSnapshotCanonical.mockResolvedValue({ status: 'SAVED', generation: 'g' });
    _resetEditorProjectGenerationForTest();
  });

  it('keeps an ordinary edit at the loaded epoch an owned edit', async () => {
    await persistProjectAutosaveSnapshot(snapshot, epoch(0));
    await persistProjectAutosaveSnapshot({ ...snapshot, title: 'Edited' }, epoch(0));
    expect(replacementFlags()).toEqual([false, false]);
  });

  it('writes a new epoch as a replacement once, then edits it as the owned project', async () => {
    await persistProjectAutosaveSnapshot(snapshot, epoch(0));
    await persistProjectAutosaveSnapshot({ ...snapshot, title: 'B' }, epoch(1));
    await persistProjectAutosaveSnapshot({ ...snapshot, title: 'B edited' }, epoch(1));
    expect(replacementFlags()).toEqual([false, true, false]);
  });

  it.each([
    ['CONFLICT', { status: 'CONFLICT' }],
    ['REFUSED', { status: 'REFUSED', reason: 'FUTURE' }],
    ['VERIFICATION_FAILED', { status: 'VERIFICATION_FAILED', reason: 'x' }],
  ])('keeps the baseline after a %s so the retry is still a replacement', async (_l, failed) => {
    h.saveAutosaveSnapshotCanonical.mockResolvedValueOnce(failed);
    await expect(persistProjectAutosaveSnapshot(snapshot, epoch(1))).rejects.toThrow();
    await persistProjectAutosaveSnapshot(snapshot, epoch(1));
    expect(replacementFlags()).toEqual([true, true]);
  });

  it('keeps the baseline after an I/O rejection', async () => {
    h.saveAutosaveSnapshotCanonical.mockRejectedValueOnce(new Error('io'));
    await expect(persistProjectAutosaveSnapshot(snapshot, epoch(1))).rejects.toThrow('io');
    expect(isReplacementPending(snapshot, 'idb', epoch(1))).toBe(true);
  });

  it('converges an older queued save and a newer replacement onto the replacement', async () => {
    await persistProjectAutosaveSnapshot(snapshot, epoch(0));
    await persistProjectAutosaveSnapshot({ ...snapshot, title: 'B' }, epoch(1));
    expect(isReplacementPending(snapshot, 'idb', epoch(1))).toBe(false);
    expect(isReplacementPending(snapshot, 'idb', epoch(0))).toBe(true);
  });

  it('never reuses another target’s baseline (project switch or Safe-Session id rekey)', async () => {
    await persistProjectAutosaveSnapshot(snapshot, epoch(2));
    await persistProjectAutosaveSnapshot({ ...snapshot, id: 'rekeyed' }, epoch(2));
    expect(replacementFlags()).toEqual([true, true]);
  });

  it('never reuses a baseline across storage authorities', async () => {
    await persistProjectAutosaveSnapshot(snapshot, epoch(2));
    expect(isReplacementPending(snapshot, 'fs', epoch(2))).toBe(true);
  });

  it('binds a desktop build running on its IndexedDB fallback to the idb baseline, not fs', async () => {
    h.isTauriRuntime.mockReturnValue(true);
    h.projectAuthority.mockReturnValue('idb');
    await persistProjectAutosaveSnapshot(snapshot, epoch(1));
    expect(isReplacementPending(snapshot, 'idb', epoch(1))).toBe(false);
    expect(isReplacementPending(snapshot, 'fs', epoch(1))).toBe(true);
    h.projectAuthority.mockReturnValue(undefined);
  });

  it('keeps the desktop generation/incarnation fence fail-closed and the baseline untouched', async () => {
    h.isTauriRuntime.mockReturnValue(true);
    h.saveProject.mockRejectedValueOnce(new StaleProjectWriterError('project-1'));
    await expect(persistProjectAutosaveSnapshot(snapshot, epoch(1))).rejects.toBeInstanceOf(
      StaleProjectWriterError,
    );
    expect(h.saveProject).toHaveBeenCalledWith({ data: snapshot }, { replacement: true });
    expect(isReplacementPending(snapshot, 'fs', epoch(1))).toBe(true);
  });
});
