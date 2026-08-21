export interface IdbUnlockUiState {
  isDesktop: boolean;
  encryptionEnabled: boolean;
  encryptionReady: boolean;
  hasRecoveryJournal: boolean;
}

// QNBS-v3: desktop project files remain plaintext until R-15, so the global IDB unlock prompt is web-only.
export function shouldShowIdbUnlockModal(state: IdbUnlockUiState): boolean {
  return (
    !state.isDesktop &&
    state.encryptionEnabled &&
    !state.encryptionReady &&
    !state.hasRecoveryJournal
  );
}
