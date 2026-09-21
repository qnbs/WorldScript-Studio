/**
 * Process-lifetime "safe session" for a desktop launch whose active project was refused at startup
 * (schema this build cannot edit). Refusing a project is a storage-admission verdict; opening the
 * application shell without it is a separate startup decision, and neither grants write authority.
 *
 * While a safe session is active:
 * - before the user explicitly starts, imports, or opens a project (portal exit), NO project
 *   persistence is admitted — so the refused project, its files, and the active-project marker
 *   (which the filesystem store only advances after a successful project write) stay untouched;
 * - afterwards, only projects other than the refused one may persist, under a session-minted identity.
 *
 * Deliberately free of Redux/DOM imports so the fence stays a pure, unit-testable boundary.
 */

export type ProjectPersistenceFenceReason = 'safe-session-unestablished' | 'refused-project';

// QNBS-v3: typed refusal (no project IDs in the message — directory names can be derived from manuscript titles) so save UIs can distinguish a fence from a storage failure without leaking identity.
export class ProjectPersistenceFencedError extends Error {
  constructor(public readonly reason: ProjectPersistenceFenceReason) {
    super('Project persistence is not permitted for this session.');
    this.name = 'ProjectPersistenceFencedError';
  }
}

interface SafeSession {
  readonly refusedProjectId: string;
  established: boolean;
}

let safeSession: SafeSession | null = null;

/** Enters the safe session for one refused project. Idempotent for the same project; fails closed otherwise. */
export function enterSafeSession(refusedProjectId: string): void {
  if (safeSession?.refusedProjectId === refusedProjectId) return;
  safeSession = { refusedProjectId, established: false };
}

export function isSafeSessionActive(): boolean {
  return safeSession !== null;
}

function fenceReason(projectId: string | undefined): ProjectPersistenceFenceReason | null {
  if (!safeSession) return null;
  if (!safeSession.established) return 'safe-session-unestablished';
  // QNBS-v3: an id-less snapshot is refused too — the filesystem store would route it by title, which could name the refused project's directory.
  if (!projectId || projectId === safeSession.refusedProjectId) return 'refused-project';
  return null;
}

/** Non-throwing admission check for callers that must skip (never reject) — e.g. quit/visibility flushes. */
export function isProjectPersistenceAdmitted(projectId: string | undefined): boolean {
  return fenceReason(projectId) === null;
}

export function assertProjectPersistenceAdmitted(projectId: string | undefined): void {
  const reason = fenceReason(projectId);
  if (reason) throw new ProjectPersistenceFencedError(reason);
}

function mintSessionProjectId(refusedProjectId: string): string {
  let projectId: string;
  do {
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    projectId = `project-${random}`;
  } while (projectId === refusedProjectId);
  return projectId;
}

/**
 * Explicit project establishment (welcome-portal exit): gives the in-memory project a fresh unique
 * identity when it has none of its own, then lifts the fence. `assignIdentity` MUST re-key the live
 * project synchronously; the fence lifts only after it returns, so no snapshot can persist under a
 * stale identity. A no-op outside a safe session or when the project already holds a usable identity.
 */
export function establishSafeSessionProject(
  currentProjectId: string | undefined,
  assignIdentity: (projectId: string) => void,
): void {
  const session = safeSession;
  if (!session) return;
  const needsFreshIdentity =
    !session.established || !currentProjectId || currentProjectId === session.refusedProjectId;
  if (!needsFreshIdentity) return;
  assignIdentity(mintSessionProjectId(session.refusedProjectId));
  session.established = true;
}

/** Test-only reset; a real page lifetime never leaves a safe session (Retry reloads the page). */
export function _resetSafeSessionForTest(): void {
  safeSession = null;
}
