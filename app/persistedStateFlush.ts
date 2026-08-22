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
  await Promise.all(saves);
}