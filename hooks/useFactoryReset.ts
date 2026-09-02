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
      // QNBS-v3: a failed factory reset can leave partial cleanup behind — never reuse encryptionRecoveryFailed's "your data has not been lost" claim here.
      setError(t('settings.data.dangerZone.factoryReset.failed'));
      logger.error('Factory reset failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [t, setBusy, setError]);
}
