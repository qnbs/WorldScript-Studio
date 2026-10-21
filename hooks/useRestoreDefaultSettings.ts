import { useCallback } from 'react';
import { useAppDispatch } from '../app/hooks';
import { useToast } from '../components/ui/Toast';
import { settingsActions } from '../features/settings/settingsSlice';
import { useTranslation } from './useTranslation';

/**
 * Settings → Data → Restore default settings (#818): resets the settings slice (projects, API keys
 * and the privacy-relevant choices are kept, see settingsSlice.resetToDefaults), then confirms.
 */
export function useRestoreDefaultSettings(onDone: () => void): () => void {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const { t } = useTranslation();
  return useCallback(() => {
    dispatch(settingsActions.resetToDefaults());
    onDone();
    toast.success(t('settings.data.dangerZone.settingsReset.done'));
  }, [dispatch, onDone, toast, t]);
}
