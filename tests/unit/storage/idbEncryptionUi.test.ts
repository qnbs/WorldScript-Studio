import { describe, expect, it } from 'vitest';
import { shouldShowIdbUnlockModal } from '../../../services/storage/idbEncryptionUi';

const baseState = {
  isDesktop: false,
  encryptionEnabled: true,
  encryptionReady: false,
  hasRecoveryJournal: false,
};

describe('shouldShowIdbUnlockModal', () => {
  it('shows the blocking unlock prompt for locked web IndexedDB storage', () => {
    expect(shouldShowIdbUnlockModal(baseState)).toBe(true);
  });

  it('never presents the prompt as a desktop project-file protection gate', () => {
    expect(shouldShowIdbUnlockModal({ ...baseState, isDesktop: true })).toBe(false);
  });

  it('does not prompt when unlocked, disabled, or recovering', () => {
    expect(shouldShowIdbUnlockModal({ ...baseState, encryptionReady: true })).toBe(false);
    expect(shouldShowIdbUnlockModal({ ...baseState, encryptionEnabled: false })).toBe(false);
    expect(shouldShowIdbUnlockModal({ ...baseState, hasRecoveryJournal: true })).toBe(false);
  });
});
