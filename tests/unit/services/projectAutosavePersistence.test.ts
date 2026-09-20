import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../features/project/projectSlice';

const h = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  saveProject: vi.fn(async (_project: unknown) => {}),
  saveAutosaveSnapshotCanonical: vi.fn(
    async (
      _snapshot: unknown,
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
  storageService: { saveProject: (project: unknown) => h.saveProject(project) },
}));

vi.mock('../../../services/projectAutosaveCanonicalWriter', () => ({
  saveAutosaveSnapshotCanonical: (snapshot: unknown) => h.saveAutosaveSnapshotCanonical(snapshot),
  assertCanonicalAutosaveSucceeded: (result: { status: string }) => {
    if (!['SAVED', 'CREATED', 'MIGRATED_AND_SAVED'].includes(result.status)) {
      throw new Error(`Canonical autosave did not commit (${result.status})`);
    }
  },
}));

import { persistProjectAutosaveSnapshot } from '../../../services/projectAutosavePersistence';

const snapshot = { id: 'project-1', title: 'A Project' } as ProjectData;

describe('persistProjectAutosaveSnapshot', () => {
  beforeEach(() => {
    h.isTauriRuntime.mockReturnValue(false);
    h.saveProject.mockClear();
    h.saveAutosaveSnapshotCanonical.mockClear();
  });

  it('routes web autosave through the canonical writer', async () => {
    await persistProjectAutosaveSnapshot(snapshot);

    expect(h.saveAutosaveSnapshotCanonical).toHaveBeenCalledWith(snapshot);
    expect(h.saveProject).not.toHaveBeenCalled();
  });

  it('preserves the filesystem backend for desktop autosave', async () => {
    h.isTauriRuntime.mockReturnValue(true);

    await persistProjectAutosaveSnapshot(snapshot);

    expect(h.saveProject).toHaveBeenCalledWith({ data: snapshot });
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
