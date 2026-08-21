import { useEffect, useRef } from 'react';
import type { AppDispatch } from '../app/store';
import { useTransientUiStore } from '../app/transientUiStore';
import { featureFlagsActions } from '../features/featureFlags/featureFlagsSlice';
import { createLogger } from '../services/logger';
import { readEncryptionMigrationJournal } from '../services/storage/encryptionMigrationJournal';
import { shouldShowIdbUnlockModal } from '../services/storage/idbEncryptionUi';
import { hasPassphraseSentinel } from '../services/storage/storageEncryptionService';

const log = createLogger('idbUnlockStartupGuard');

interface IdbUnlockStartupGuardOptions {
  isDesktop: boolean;
  encryptionEnabled: boolean;
  encryptionReady: boolean;
  hasRecoveryJournal: boolean;
  dispatch: AppDispatch;
}

// QNBS-v3: keep the asynchronous sentinel check outside App.tsx so its desktop admission policy is independently testable.
export function useIdbUnlockStartupGuard({
  isDesktop,
  encryptionEnabled,
  encryptionReady,
  hasRecoveryJournal,
  dispatch,
}: IdbUnlockStartupGuardOptions): void {
  const setIdbUnlockOpen = useTransientUiStore((state) => state.setIdbUnlockOpen);
  const recoveryJournalRef = useRef(hasRecoveryJournal);

  useEffect(() => {
    recoveryJournalRef.current = hasRecoveryJournal;
  }, [hasRecoveryJournal]);

  useEffect(() => {
    if (
      !shouldShowIdbUnlockModal({
        isDesktop,
        encryptionEnabled,
        encryptionReady,
        hasRecoveryJournal,
      })
    )
      return;
    void (async () => {
      let journalBeforeSentinel: Awaited<ReturnType<typeof readEncryptionMigrationJournal>>;
      try {
        journalBeforeSentinel = await readEncryptionMigrationJournal();
      } catch (error) {
        log.warn('IDB encryption journal check failed during startup', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return;
      }
      if (journalBeforeSentinel || recoveryJournalRef.current) return;

      let hasSentinel: boolean;
      try {
        hasSentinel = await hasPassphraseSentinel();
      } catch (error) {
        log.warn('IDB encryption sentinel check failed during startup', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return;
      }

      let journalAfterSentinel: Awaited<ReturnType<typeof readEncryptionMigrationJournal>>;
      try {
        journalAfterSentinel = await readEncryptionMigrationJournal();
      } catch (error) {
        log.warn('IDB encryption journal recheck failed during startup', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
        return;
      }
      if (journalAfterSentinel || recoveryJournalRef.current) return;
      if (!hasSentinel) {
        dispatch(featureFlagsActions.setEnableIdbAtRestEncryption(false));
        return;
      }
      setIdbUnlockOpen(true);
    })();
  }, [
    dispatch,
    encryptionEnabled,
    encryptionReady,
    hasRecoveryJournal,
    isDesktop,
    setIdbUnlockOpen,
  ]);
}
