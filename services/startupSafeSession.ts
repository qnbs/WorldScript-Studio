/**
 * Process-lifetime "safe session" for a desktop launch whose active project was refused at startup
 * (schema this build cannot edit). Refusing a project is a storage-admission verdict; opening the
 * application shell without it is a separate startup decision, and neither grants write authority.
 *
 * The session owns exactly ONE writable project identity, minted when the session is entered and
 * never equal to the refused project. While the session is active:
 * - project-scoped storage writes (images, codex, vectors, binder assets, deletes) are admitted for
 *   that identity only, so nothing can reach the refused project's namespace;
 * - the project DOCUMENT is additionally not persisted until the user explicitly starts or imports
 *   a project (portal exit) — so the refused project, its files, and the active-project marker
 *   (which the filesystem store only advances after a successful project write) stay untouched.
 *
 * Deliberately free of Redux/DOM imports so the fence stays a pure, unit-testable boundary.
 */

export type ProjectPersistenceFenceReason =
  | 'safe-session-unestablished'
  | 'outside-session-identity';

// QNBS-v3: typed refusal (no project IDs in the message — directory names can be derived from manuscript titles) so save UIs can distinguish a fence from a storage failure without leaking identity.
export class ProjectPersistenceFencedError extends Error {
  constructor(public readonly reason: ProjectPersistenceFenceReason) {
    super('Project persistence is not permitted for this session.');
    this.name = 'ProjectPersistenceFencedError';
  }
}

interface SafeSession {
  readonly refusedProjectId: string;
  readonly sessionProjectId: string;
  established: boolean;
}

let safeSession: SafeSession | null = null;

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

/** Enters the safe session for one refused project. Idempotent for the same project; fails closed otherwise. */
export function enterSafeSession(refusedProjectId: string): void {
  if (safeSession?.refusedProjectId === refusedProjectId) return;
  safeSession = {
    refusedProjectId,
    sessionProjectId: mintSessionProjectId(refusedProjectId),
    established: false,
  };
}

export function isSafeSessionActive(): boolean {
  return safeSession !== null;
}

/** The session's only writable project identity, or null outside a safe session. */
export function getSafeSessionProjectId(): string | null {
  return safeSession?.sessionProjectId ?? null;
}

// QNBS-v3: allow-only-the-session-identity (not deny-the-refused-ID) — an ID-less or aliased identity could resolve to the refused project's directory through the backend's default/title routing.
function namespaceFenceReason(projectId: string | undefined): ProjectPersistenceFenceReason | null {
  if (!safeSession) return null;
  return projectId === safeSession.sessionProjectId ? null : 'outside-session-identity';
}

function documentFenceReason(projectId: string | undefined): ProjectPersistenceFenceReason | null {
  if (!safeSession) return null;
  if (!safeSession.established) return 'safe-session-unestablished';
  return namespaceFenceReason(projectId);
}

/** Non-throwing document check for callers that must skip (never reject) — e.g. quit/visibility flushes. */
export function isProjectPersistenceAdmitted(projectId: string | undefined): boolean {
  return documentFenceReason(projectId) === null;
}

/** Fence for persisting a project DOCUMENT (autosave, flush, manual save, saveProject). */
export function assertProjectPersistenceAdmitted(projectId: string | undefined): void {
  const reason = documentFenceReason(projectId);
  if (reason) throw new ProjectPersistenceFencedError(reason);
}

/** Fence for project-scoped auxiliary writes/deletes (images, codex, vectors, binder assets). */
export function assertProjectNamespaceWriteAdmitted(projectId: string | undefined): void {
  const reason = namespaceFenceReason(projectId);
  if (reason) throw new ProjectPersistenceFencedError(reason);
}

/**
 * Explicit project establishment (welcome-portal exit): re-keys the live project to the session
 * identity when it does not already hold it, then lifts the document fence. `assignIdentity` MUST
 * re-key the live project synchronously; the fence lifts only after it returns, so no snapshot can
 * persist under a stale identity. A no-op outside a safe session.
 */
export function establishSafeSessionProject(
  currentProjectId: string | undefined,
  assignIdentity: (projectId: string) => void,
): void {
  const session = safeSession;
  if (!session) return;
  if (currentProjectId !== session.sessionProjectId) assignIdentity(session.sessionProjectId);
  session.established = true;
}

/** Test-only reset; a real page lifetime never leaves a safe session (Retry reloads the page). */
export function _resetSafeSessionForTest(): void {
  safeSession = null;
}
