import { useEffect, useRef } from 'react';
import type { AppDispatch } from '../app/store';
import { useTransientUiStore } from '../app/transientUiStore';
import { featureFlagsActions } from '../features/featureFlags/featureFlagsSlice';
import { shouldShowIdbUnlockModal } from '../services/storage/idbEncryptionUi';
import { hasPassphraseSentinel } from '../services/storage/storageEncryptionService';

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
      const hasSentinel = await hasPassphraseSentinel();
      if (!hasSentinel) {
        dispatch(featureFlagsActions.setEnableIdbAtRestEncryption(false));
        return;
      }
      if (recoveryJournalRef.current) return;
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
