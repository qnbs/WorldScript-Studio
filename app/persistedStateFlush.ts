import type { ProjectData } from '../features/project/projectSlice';
import { isFactoryResetInProgress } from '../services/factoryResetService';
import { persistProjectAutosaveSnapshot } from '../services/projectAutosavePersistence';
import { isProjectPersistenceAdmitted } from '../services/startupSafeSession';
import { storageService } from '../services/storageService';
import {
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
  const presentData = state.project.present?.data;
  // QNBS-v3 (#332): make visibility and quit flushes wait behind both active and queued saves.
  const saves: Promise<unknown>[] = [
    settingsPersistenceCoordinator.enqueue(() => storageService.saveSettings(state.settings)),
  ];
  let confirmProjectSave: (() => Promise<unknown>) | null = null;
  // QNBS-v3: a fenced safe-session project is skipped, never rejected — quitApp aborts on any flush rejection, so a fence must not make the window unquittable.
  if (presentData && isProjectPersistenceAdmitted(presentData.id)) {
    const enriched: ProjectData = {
      ...presentData,
      persistedVersionControl: {
        branches: state.versionControl.branches,
        snapshots: state.versionControl.snapshots,
        currentBranchId: state.versionControl.currentBranchId,
      },
    };
    const saveProject = () =>
      projectPersistenceCoordinator.enqueue(() => persistProjectAutosaveSnapshot(enriched));
    confirmProjectSave = saveProject;
    saves.push(saveProject());
  }
  // QNBS-v3: allSettled, not Promise.all — its fail-fast let a caller reload before the other save finished; both must settle first, still failing closed if either rejected.
  const results = await Promise.allSettled(saves);
  // QNBS-v3: a coordinator that rejected can already be running a superseding queued save it never told us about — wait for both to genuinely drain before returning or throwing.
  await Promise.all([settingsPersistenceCoordinator.idle(), projectPersistenceCoordinator.idle()]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
  // QNBS-v3 (#553): a superseded project result is not proof the project was saved — the coordinator resolves (not rejects) a waiter whose own failed attempt had a queued successor, and that successor's later rejection never reaches this flush. One confirming save makes its real outcome this flush's answer, so a quit can never mistake an unsaved project for a saved one and skip the stale-writer discard consent.
  const project = results[1];
  if (confirmProjectSave && project?.status === 'fulfilled' && isSuperseded(project.value)) {
    await confirmProjectSave();
    await projectPersistenceCoordinator.idle();
  }
}

function isSuperseded(value: unknown): boolean {
  return (value as { superseded?: unknown } | undefined)?.superseded === true;
}
