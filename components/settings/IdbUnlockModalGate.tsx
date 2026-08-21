import type { FC } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { desktopPlatform } from '../../services/desktopPlatform';
import { shouldShowIdbUnlockModal } from '../../services/storage/idbEncryptionUi';
import { isIdbEncryptionReady } from '../../services/storage/storageEncryptionService';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { IdbUnlockModal } from './IdbUnlockModal';

interface Props {
  isOpen: boolean;
  encryptionEnabled: boolean;
  hasRecoveryJournal: boolean;
}

// QNBS-v3: gate the global prompt at the render boundary so desktop can never imply FS encryption.
export const IdbUnlockModalGate: FC<Props> = ({
  isOpen,
  encryptionEnabled,
  hasRecoveryJournal,
}) => {
  const setIdbUnlockOpen = useTransientUiStore((state) => state.setIdbUnlockOpen);
  if (
    !isOpen ||
    !shouldShowIdbUnlockModal({
      isDesktop: desktopPlatform.runtime.isDesktop,
      encryptionEnabled,
      encryptionReady: isIdbEncryptionReady(),
      hasRecoveryJournal,
    })
  )
    return null;
  return (
    <ErrorBoundary onReset={() => setIdbUnlockOpen(false)}>
      <IdbUnlockModal onUnlocked={() => setIdbUnlockOpen(false)} />
    </ErrorBoundary>
  );
};
