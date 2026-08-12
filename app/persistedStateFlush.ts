import type { ProjectData } from '../features/project/projectSlice';
import { saveEnvelopeFromProjectData, storageService } from '../services/storageService';
import type { RootState } from './store';

/**
 * QNBS-v3 (#332/D3): shared, awaitable flush of pending project+settings state. Used by both the
 * best-effort `visibilitychange` handler (index.tsx) and the desktop close-to-tray quit flush
 * (App.tsx via desktopTray.ts), so an edit made just before a tab hide or window close isn't
 * silently dropped by the 1s debounced autosave in `app/listenerMiddleware.ts`.
 */
export async function flushPersistedState(state: RootState): Promise<void> {
  const presentData = state.project.present?.data;
  if (!presentData) return;
  const enriched: ProjectData = {
    ...presentData,
    persistedVersionControl: {
      branches: state.versionControl.branches,
      snapshots: state.versionControl.snapshots,
      currentBranchId: state.versionControl.currentBranchId,
    },
  };
  await Promise.allSettled([
    storageService.saveProject(saveEnvelopeFromProjectData(enriched)),
    storageService.saveSettings(state.settings),
  ]);
}
