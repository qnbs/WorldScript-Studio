import { useSyncExternalStore } from 'react';
import {
  isIdbEncryptionReady,
  subscribeToEncryptionReadyChanges,
} from '../services/storage/storageEncryptionService';

// QNBS-v3: useSyncExternalStore safely reflects the mutable active-key state across App.tsx global unlocks and Settings lock/unlock handlers without render tearing.
export function useEncryptionReady(): boolean {
  return useSyncExternalStore(
    subscribeToEncryptionReadyChanges,
    isIdbEncryptionReady,
    isIdbEncryptionReady,
  );
}
