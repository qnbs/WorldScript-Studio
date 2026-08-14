import { useCallback } from 'react';
import { wipeAllAppData } from '../services/factoryResetService';
import { logger } from '../services/logger';

interface Options {
  t: (key: string) => string;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
}

/**
 * Shared confirm → wipeAllAppData → busy/error handling for the danger-zone factory-reset
 * action, used by both the passphrase-unlock modal and the encryption-recovery modal.
 */
export function useFactoryReset({ t, setBusy, setError }: Options): () => Promise<void> {
  return useCallback(async () => {
    if (!window.confirm(t('settings.data.dangerZone.factoryReset.modalWarning'))) return;
    setBusy(true);
    setError('');
    try {
      await wipeAllAppData();
    } catch (err) {
      setError(t('settings.privacy.encryptionRecoveryFailed'));
      logger.error('Factory reset failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [t, setBusy, setError]);
}
