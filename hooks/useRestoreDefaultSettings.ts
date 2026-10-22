import { useCallback } from 'react';
import type { AppDispatch } from '../app/store';
import type { useToast } from '../components/ui/Toast';
import { settingsActions } from '../features/settings/settingsSlice';

/**
 * Settings → Data → Restore default settings (#818): resets the settings slice (projects, API keys
 * and the privacy-relevant choices are kept, see settingsSlice.resetToDefaults), closes the dialog
 * and confirms. Dependencies come from useSettingsView, which already owns them.
 */
export function useRestoreDefaultSettings(
  dispatch: AppDispatch,
  toast: ReturnType<typeof useToast>,
  t: (key: string) => string,
  setModal: (next: { state: 'closed'; payload: Record<string, never> }) => void,
): () => void {
  return useCallback(() => {
    dispatch(settingsActions.resetToDefaults());
    setModal({ state: 'closed', payload: {} });
    toast.success(t('settings.data.dangerZone.settingsReset.done'));
  }, [dispatch, toast, t, setModal]);
}
