import type { ProjectData } from '../features/project/projectSlice';
import { toEditorReplacementEpoch } from '../services/editorProjectGeneration';
import { isFactoryResetInProgress } from '../services/factoryResetService';
import { persistProjectAutosaveSnapshot } from '../services/projectAutosavePersistence';
import { isProjectPersistenceAdmitted } from '../services/startupSafeSession';
import { storageService } from '../services/storageService';
import {
  type ChainMark,
  projectPersistenceCoordinator,
  settingsPersistenceCoordinator,
} from './persistenceCoordinator';
import type { RootState } from './store';

/**
 * QNBS-v3 (#332/D3): shared, awaitable flush of pending project+settings state. Used by both the
 * best-effort `visibilitychange` handler (index.tsx) and the desktop close-to-tray quit flush
 * (App.tsx via desktopTray.ts), so an edit made just before a tab hide or window close isn't
 * silently dropped by the 1s debounced autosave in `app/listenerMiddleware.ts`. Settings save
 * independently of project data, and any save failure rejects (fail closed) instead of being
 * swallowed by Promise.allSettled — callers decide their own failure policy.
 */
export async function flushPersistedState(state: RootState): Promise<void> {
  // QNBS-v3: window.location.reload() fires visibilitychange before the page actually unloads -- without this, a factory reset's own reload races this flush, recreating the just-deleted database with stale pre-reset state.
  if (isFactoryResetInProgress()) return;
  // QNBS-v3 (#553): marked BEFORE enqueuing, so the flush can later observe exactly the chains that were running or started while it was in flight — including a save enqueued after its own results settled.
  const settingsMark = settingsPersistenceCoordinator.chainMark();
  const projectMark = projectPersistenceCoordinator.chainMark();
  const presentData = state.project.present?.data;
  // QNBS-v3 (#332): make visibility and quit flushes wait behind both active and queued saves.
  const saves: Promise<unknown>[] = [
    settingsPersistenceCoordinator.enqueue(() => storageService.saveSettings(state.settings)),
  ];
  // QNBS-v3: a fenced safe-session project is skipped, never rejected — quitApp aborts on any flush rejection, so a fence must not make the window unquittable.
  if (presentData && isProjectPersistenceAdmitted(presentData.id)) {
    const editorEpoch = toEditorReplacementEpoch(state.project.present?.generation);
    const enriched: ProjectData = {
      ...presentData,
      persistedVersionControl: {
        branches: state.versionControl.branches,
        snapshots: state.versionControl.snapshots,
        currentBranchId: state.versionControl.currentBranchId,
      },
    };
    saves.push(
      projectPersistenceCoordinator.enqueue(() =>
        persistProjectAutosaveSnapshot(enriched, editorEpoch),
      ),
    );
  }
  // QNBS-v3: allSettled, not Promise.all — its fail-fast let a caller reload before the other save finished; both must settle first, still failing closed if either rejected.
  const results = await Promise.allSettled(saves);
  // QNBS-v3: a coordinator that rejected can already be running a superseding queued save it never told us about — wait for both to genuinely drain before returning or throwing.
  await Promise.all([settingsPersistenceCoordinator.idle(), projectPersistenceCoordinator.idle()]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
  // QNBS-v3 (#553): a resolved (even superseded) result is not proof that everything pending was saved — a waiter is resolved when its own failed attempt had a queued successor, and a save enqueued after this flush's results settled forms a separate chain. Every chain active at the pre-enqueue mark or started since then must have ended in success; each is read from its own outcome promise (never a shared "last outcome"), and a history gap fails closed. The older captured snapshot is never re-enqueued.
  await assertStableSuccessSince(settingsMark, projectMark);
}

const MAX_VERIFICATION_PASSES = 5;

// QNBS-v3 (#553): the boundary is the moment this flush returns, not the moment it first snapshotted — a chain started while an earlier pass was still awaiting (e.g. a settings save enqueued during the project check) is picked up by the next pass. Returns only after a full pass in which neither queue started a new chain; continuous saving past the pass limit fails closed rather than claiming success.
async function assertStableSuccessSince(
  settingsMark: ChainMark,
  projectMark: ChainMark,
): Promise<void> {
  for (let pass = 0; pass < MAX_VERIFICATION_PASSES; pass++) {
    const settingsSeq = settingsPersistenceCoordinator.chainMark().seq;
    const projectSeq = projectPersistenceCoordinator.chainMark().seq;
    await assertChainsSucceededSince(settingsPersistenceCoordinator, settingsMark);
    await assertChainsSucceededSince(projectPersistenceCoordinator, projectMark);
    if (
      settingsPersistenceCoordinator.chainMark().seq === settingsSeq &&
      projectPersistenceCoordinator.chainMark().seq === projectSeq
    ) {
      return;
    }
  }
  throw new Error('Persistence kept changing during this flush; cannot prove it saved.');
}

async function assertChainsSucceededSince(
  coordinator: typeof projectPersistenceCoordinator,
  mark: ChainMark,
): Promise<void> {
  const outcomes = coordinator.outcomesSince(mark);
  if (outcomes === null) {
    throw new Error('Persistence history no longer covers this flush; cannot prove it saved.');
  }
  for (const outcome of await Promise.all(outcomes)) {
    if (!outcome.ok) throw outcome.error;
  }
}
