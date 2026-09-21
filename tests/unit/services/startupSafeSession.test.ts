/**
 * Tests for services/startupSafeSession.ts and the persistence choke point it fences.
 * A refused (non-editable) desktop project must never gain write authority through Safe Open:
 * before explicit establishment nothing persists; afterwards only a session-minted identity does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../features/project/projectSlice';

const h = vi.hoisted(() => ({
  isTauri: { value: true },
  saveProject: vi.fn(async (_input: unknown) => {}),
  saveAutosaveSnapshotCanonical: vi.fn(async (_snapshot: unknown) => ({
    status: 'SAVED' as const,
    generation: 'g',
  })),
}));

vi.mock('../../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));
vi.mock('../../../services/storageService', () => ({
  storageService: { saveProject: h.saveProject },
}));
vi.mock('../../../services/projectAutosaveCanonicalWriter', () => ({
  saveAutosaveSnapshotCanonical: h.saveAutosaveSnapshotCanonical,
  assertCanonicalAutosaveSucceeded: () => {},
}));

import { persistProjectAutosaveSnapshot } from '../../../services/projectAutosavePersistence';
import {
  _resetSafeSessionForTest,
  assertProjectPersistenceAdmitted,
  enterSafeSession,
  establishSafeSessionProject,
  isProjectPersistenceAdmitted,
  isSafeSessionActive,
  ProjectPersistenceFencedError,
} from '../../../services/startupSafeSession';

const REFUSED = 'refused-project-dir';
const snapshot = (id: string | undefined) => ({ id, title: 't' }) as unknown as ProjectData;

/** Establishes the session and returns the identity the store would have been re-keyed to. */
function establish(currentProjectId: string | undefined = 'default'): string {
  let minted = '';
  establishSafeSessionProject(currentProjectId, (projectId) => {
    minted = projectId;
  });
  return minted;
}

beforeEach(() => {
  _resetSafeSessionForTest();
  h.isTauri.value = true;
  vi.clearAllMocks();
});

describe('startupSafeSession fence', () => {
  it('admits everything and never re-keys outside a safe session (normal CURRENT boot)', () => {
    const assign = vi.fn();
    expect(isSafeSessionActive()).toBe(false);
    expect(isProjectPersistenceAdmitted('default')).toBe(true);
    expect(isProjectPersistenceAdmitted(undefined)).toBe(true);
    expect(() => assertProjectPersistenceAdmitted('default')).not.toThrow();
    establishSafeSessionProject('default', assign);
    expect(assign).not.toHaveBeenCalled();
  });

  it('denies every project identity until the user explicitly establishes a project', () => {
    enterSafeSession(REFUSED);

    for (const id of [REFUSED, 'default', 'project-anything', undefined]) {
      expect(isProjectPersistenceAdmitted(id)).toBe(false);
    }
    expect(() => assertProjectPersistenceAdmitted('default')).toThrow(
      ProjectPersistenceFencedError,
    );
    expect(() => assertProjectPersistenceAdmitted('default')).toThrow(
      expect.objectContaining({ reason: 'safe-session-unestablished' }),
    );
  });

  it('re-keys to a fresh unique identity before lifting the fence, then admits only that identity', () => {
    enterSafeSession(REFUSED);
    let admittedWhileRekeying: boolean | undefined;
    let minted = '';

    // QNBS-v3: the fence must still be closed inside assignIdentity — lifting first would let a snapshot persist under the stale identity.
    establishSafeSessionProject('default', (projectId) => {
      minted = projectId;
      admittedWhileRekeying = isProjectPersistenceAdmitted(projectId);
    });

    expect(admittedWhileRekeying).toBe(false);
    expect(minted).toMatch(/^project-.+/);
    expect(minted).not.toBe(REFUSED);
    expect(isProjectPersistenceAdmitted(minted)).toBe(true);
    expect(isProjectPersistenceAdmitted(REFUSED)).toBe(false);
    expect(isProjectPersistenceAdmitted(undefined)).toBe(false);
    expect(() => assertProjectPersistenceAdmitted(REFUSED)).toThrow(
      expect.objectContaining({ reason: 'refused-project' }),
    );
  });

  it('keeps the fence closed when re-keying fails', () => {
    enterSafeSession(REFUSED);
    expect(() =>
      establishSafeSessionProject('default', () => {
        throw new Error('dispatch failed');
      }),
    ).toThrow('dispatch failed');
    expect(isProjectPersistenceAdmitted('default')).toBe(false);
  });

  it('mints a new identity even for a project already carrying the refused ID (id: default collision)', () => {
    enterSafeSession('default');
    const minted = establish('default');
    expect(minted).not.toBe('default');
    expect(isProjectPersistenceAdmitted(minted)).toBe(true);
    expect(isProjectPersistenceAdmitted('default')).toBe(false);
  });

  it('does not fork the identity on later portal exits, but re-keys a replacement that reuses the refused ID', () => {
    enterSafeSession(REFUSED);
    const first = establish('default');
    const assign = vi.fn();

    establishSafeSessionProject(first, assign);
    expect(assign).not.toHaveBeenCalled();

    const second = establish(REFUSED);
    expect(second).not.toBe('');
    expect(second).not.toBe(REFUSED);
    expect(second).not.toBe(first);
  });

  it('is idempotent for the same refused project and fails closed for a different one', () => {
    enterSafeSession(REFUSED);
    const minted = establish();
    enterSafeSession(REFUSED);
    expect(isProjectPersistenceAdmitted(minted)).toBe(true);

    enterSafeSession('another-refused-project');
    expect(isProjectPersistenceAdmitted(minted)).toBe(false);
  });
});

describe('persistProjectAutosaveSnapshot under the safe-session fence', () => {
  it('writes nothing before establishment — desktop filesystem and web canonical routes alike', async () => {
    enterSafeSession(REFUSED);

    for (const isTauri of [true, false]) {
      h.isTauri.value = isTauri;
      await expect(persistProjectAutosaveSnapshot(snapshot(REFUSED))).rejects.toBeInstanceOf(
        ProjectPersistenceFencedError,
      );
      await expect(persistProjectAutosaveSnapshot(snapshot('default'))).rejects.toBeInstanceOf(
        ProjectPersistenceFencedError,
      );
    }
    expect(h.saveProject).not.toHaveBeenCalled();
    expect(h.saveAutosaveSnapshotCanonical).not.toHaveBeenCalled();
  });

  it('never writes the refused identity after establishment, and writes only the minted identity', async () => {
    enterSafeSession(REFUSED);
    const minted = establish();

    await expect(persistProjectAutosaveSnapshot(snapshot(REFUSED))).rejects.toBeInstanceOf(
      ProjectPersistenceFencedError,
    );
    expect(h.saveProject).not.toHaveBeenCalled();

    await persistProjectAutosaveSnapshot(snapshot(minted));
    expect(h.saveProject).toHaveBeenCalledTimes(1);
    expect(h.saveProject).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: minted }),
    });
  });

  it('is untouched outside a safe session', async () => {
    await persistProjectAutosaveSnapshot(snapshot('default'));
    expect(h.saveProject).toHaveBeenCalledTimes(1);
  });
});
