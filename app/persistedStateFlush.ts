import type { ProjectData } from '../features/project/projectSlice';
import { saveEnvelopeFromProjectData, storageService } from '../services/storageService';
import type { RootState } from './store';
import { projectPersistenceCoordinator, settingsPersistenceCoordinator } from './persistenceCoordinator';

/**
 * QNBS-v3 (#332/D3): shared, awaitable flush of pending project+settings state. Used by both the
 * best-effort `visibilitychange` handler (index.tsx) and the desktop close-to-tray quit flush
 * (App.tsx via desktopTray.ts), so an edit made just before a tab hide or window close isn't
 * silently dropped by the 1s debounced autosave in `app/listenerMiddleware.ts`. Settings save
 * independently of project data, and any save failure rejects (fail closed) instead of being
 * swallowed by Promise.allSettled — callers decide their own failure policy.
 */
export async function flushPersistedState(state: RootState): Promise<void> {
  const presentData = state.project.present?.data;
  // QNBS-v3 (#332): make visibility and quit flushes wait behind both active and queued saves.
  const saves: Promise<unknown>[] = [
    settingsPersistenceCoordinator.enqueue(() => storageService.saveSettings(state.settings)),
  ];
  if (presentData) {
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
        storageService.saveProject(saveEnvelopeFromProjectData(enriched)),
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
}