/**
 * Tests for services/startupSafeSession.ts and the persistence choke point it fences.
 * A refused (non-editable) desktop project must never gain write authority through Safe Open:
 * the session owns exactly one writable identity, and the project document additionally stays
 * unpersisted until the user explicitly establishes a project.
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
  assertProjectNamespaceWriteAdmitted,
  assertProjectPersistenceAdmitted,
  enterSafeSession,
  establishSafeSessionProject,
  getSafeSessionProjectId,
  isProjectPersistenceAdmitted,
  isSafeSessionActive,
  ProjectPersistenceFencedError,
} from '../../../services/startupSafeSession';

const REFUSED = 'refused-project-dir';
const snapshot = (id: string | undefined) => ({ id, title: 't' }) as unknown as ProjectData;

function sessionIdentity(): string {
  const projectId = getSafeSessionProjectId();
  if (!projectId) throw new Error('expected an active safe session');
  return projectId;
}

/** Establishes the session the way the portal exit does and returns the identity it re-keyed to. */
function establish(currentProjectId: string | undefined = 'default'): string | null {
  let assigned: string | null = null;
  establishSafeSessionProject(currentProjectId, (projectId) => {
    assigned = projectId;
  });
  return assigned;
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
    expect(getSafeSessionProjectId()).toBeNull();
    expect(isProjectPersistenceAdmitted('default')).toBe(true);
    expect(isProjectPersistenceAdmitted(undefined)).toBe(true);
    expect(() => assertProjectPersistenceAdmitted('default')).not.toThrow();
    expect(() => assertProjectNamespaceWriteAdmitted('default')).not.toThrow();
    establishSafeSessionProject('default', assign);
    expect(assign).not.toHaveBeenCalled();
  });

  it('mints one session identity that differs from the refused project and stays stable', () => {
    enterSafeSession(REFUSED);
    const identity = sessionIdentity();
    expect(identity).toMatch(/^project-.+/);
    expect(identity).not.toBe(REFUSED);

    enterSafeSession(REFUSED);
    expect(sessionIdentity()).toBe(identity);

    enterSafeSession('default');
    expect(sessionIdentity()).not.toBe('default');
  });

  it('denies every project document until the user explicitly establishes a project', () => {
    enterSafeSession(REFUSED);

    for (const id of [REFUSED, 'default', sessionIdentity(), undefined]) {
      expect(isProjectPersistenceAdmitted(id)).toBe(false);
    }
    expect(() => assertProjectPersistenceAdmitted('default')).toThrow(
      ProjectPersistenceFencedError,
    );
    expect(() => assertProjectPersistenceAdmitted('default')).toThrow(
      expect.objectContaining({ reason: 'safe-session-unestablished' }),
    );
  });

  // QNBS-v3: auxiliary namespaces (images, codex, vectors, binder assets) admit ONLY the session identity — even before establishment, so an import can write its images — never the refused, default, or unset one.
  it('admits project-scoped namespace writes for the session identity only', () => {
    enterSafeSession(REFUSED);
    expect(() => assertProjectNamespaceWriteAdmitted(sessionIdentity())).not.toThrow();

    for (const id of [REFUSED, 'default', 'another-project', undefined]) {
      expect(() => assertProjectNamespaceWriteAdmitted(id)).toThrow(
        expect.objectContaining({ reason: 'outside-session-identity' }),
      );
    }
  });

  it('re-keys to the session identity before lifting the document fence, then admits only that identity', () => {
    enterSafeSession(REFUSED);
    let admittedWhileRekeying: boolean | undefined;

    // QNBS-v3: the fence must still be closed inside assignIdentity — lifting first would let a snapshot persist under the stale identity.
    establishSafeSessionProject('default', (projectId) => {
      admittedWhileRekeying = isProjectPersistenceAdmitted(projectId);
    });

    expect(admittedWhileRekeying).toBe(false);
    expect(isProjectPersistenceAdmitted(sessionIdentity())).toBe(true);
    for (const id of [REFUSED, 'default', undefined]) {
      expect(isProjectPersistenceAdmitted(id)).toBe(false);
    }
    expect(() => assertProjectPersistenceAdmitted(REFUSED)).toThrow(
      expect.objectContaining({ reason: 'outside-session-identity' }),
    );
  });

  it('keeps the fence closed when re-keying fails', () => {
    enterSafeSession(REFUSED);
    expect(() =>
      establishSafeSessionProject('default', () => {
        throw new Error('dispatch failed');
      }),
    ).toThrow('dispatch failed');
    expect(isProjectPersistenceAdmitted(sessionIdentity())).toBe(false);
  });

  it('re-keys the id: default collision, and does not re-key a project already holding the identity', () => {
    enterSafeSession('default');
    expect(establish('default')).toBe(sessionIdentity());
    expect(isProjectPersistenceAdmitted('default')).toBe(false);

    // A later portal exit that finds the session identity already in place leaves the project alone.
    expect(establish(sessionIdentity())).toBeNull();
    expect(isProjectPersistenceAdmitted(sessionIdentity())).toBe(true);
    // ...while a wholesale replacement that reset the ID is re-keyed to the same identity, never a fork.
    expect(establish('default')).toBe(sessionIdentity());
  });

  it('fails closed when a different project is refused later', () => {
    enterSafeSession(REFUSED);
    establish();
    const first = sessionIdentity();
    expect(isProjectPersistenceAdmitted(first)).toBe(true);

    enterSafeSession('another-refused-project');
    expect(sessionIdentity()).not.toBe(first);
    expect(isProjectPersistenceAdmitted(sessionIdentity())).toBe(false);
  });
});

describe('persistProjectAutosaveSnapshot under the safe-session fence', () => {
  it('writes nothing before establishment — desktop filesystem and web canonical routes alike', async () => {
    enterSafeSession(REFUSED);

    for (const isTauri of [true, false]) {
      h.isTauri.value = isTauri;
      for (const id of [REFUSED, 'default', sessionIdentity()]) {
        await expect(persistProjectAutosaveSnapshot(snapshot(id))).rejects.toBeInstanceOf(
          ProjectPersistenceFencedError,
        );
      }
    }
    expect(h.saveProject).not.toHaveBeenCalled();
    expect(h.saveAutosaveSnapshotCanonical).not.toHaveBeenCalled();
  });

  it('never writes the refused identity after establishment, and writes only the session identity', async () => {
    enterSafeSession(REFUSED);
    establish();

    await expect(persistProjectAutosaveSnapshot(snapshot(REFUSED))).rejects.toBeInstanceOf(
      ProjectPersistenceFencedError,
    );
    await expect(persistProjectAutosaveSnapshot(snapshot('default'))).rejects.toBeInstanceOf(
      ProjectPersistenceFencedError,
    );
    expect(h.saveProject).not.toHaveBeenCalled();

    await persistProjectAutosaveSnapshot(snapshot(sessionIdentity()));
    expect(h.saveProject).toHaveBeenCalledTimes(1);
    expect(h.saveProject).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: sessionIdentity() }),
    });
  });

  it('is untouched outside a safe session', async () => {
    await persistProjectAutosaveSnapshot(snapshot('default'));
    expect(h.saveProject).toHaveBeenCalledTimes(1);
  });
});
