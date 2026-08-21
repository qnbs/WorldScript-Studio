import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetOpen, mockHasSentinel, mockReadJournal, mockWarn } = vi.hoisted(() => ({
  mockSetOpen: vi.fn(),
  mockHasSentinel: vi.fn(),
  mockReadJournal: vi.fn(),
  mockWarn: vi.fn(),
}));

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (selector: (state: { setIdbUnlockOpen: typeof mockSetOpen }) => unknown) =>
    selector({ setIdbUnlockOpen: mockSetOpen }),
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  hasPassphraseSentinel: mockHasSentinel,
}));

vi.mock('../../../services/storage/encryptionMigrationJournal', () => ({
  readEncryptionMigrationJournal: mockReadJournal,
}));

vi.mock('../../../services/logger', () => ({
  createLogger: () => ({ warn: mockWarn }),
}));

vi.mock('../../../features/featureFlags/featureFlagsSlice', () => ({
  featureFlagsActions: {
    setEnableIdbAtRestEncryption: (enabled: boolean) => ({ type: 'flags/set', payload: enabled }),
  },
}));

import { useIdbUnlockStartupGuard } from '../../../hooks/useIdbUnlockStartupGuard';

const options = {
  isDesktop: false,
  encryptionEnabled: true,
  encryptionReady: false,
  hasRecoveryJournal: false,
  dispatch: vi.fn(),
};

describe('useIdbUnlockStartupGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadJournal.mockResolvedValue(null);
    mockHasSentinel.mockResolvedValue(true);
  });

  it('opens the web unlock prompt when the sentinel exists', async () => {
    renderHook(() => useIdbUnlockStartupGuard(options));
    await waitFor(() => expect(mockSetOpen).toHaveBeenCalledWith(true));
  });

  it('never opens the global prompt on desktop', async () => {
    renderHook(() => useIdbUnlockStartupGuard({ ...options, isDesktop: true }));
    await act(async () => Promise.resolve());
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  it('disables a stale encryption flag when the sentinel is absent', async () => {
    mockHasSentinel.mockResolvedValue(false);
    const dispatch = vi.fn();
    renderHook(() => useIdbUnlockStartupGuard({ ...options, dispatch }));
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({ type: 'flags/set', payload: false }),
    );
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  // QNBS-v3: a recovery journal resolving during the sentinel lookup must prevent a destructive flag change.
  it('keeps encryption enabled when recovery starts during the sentinel lookup', async () => {
    mockReadJournal.mockResolvedValueOnce(null).mockResolvedValueOnce({ phase: 'migrating' });
    mockHasSentinel.mockResolvedValue(false);
    const dispatch = vi.fn();
    renderHook(() => useIdbUnlockStartupGuard({ ...options, dispatch }));
    await waitFor(() => expect(mockReadJournal).toHaveBeenCalledTimes(2));
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockSetOpen).not.toHaveBeenCalled();
  });

  // QNBS-v3: sentinel storage failures stay fail-closed and become sanitized diagnostics, not unhandled rejections.
  it('does not mutate flags or open the prompt when sentinel lookup fails', async () => {
    mockHasSentinel.mockRejectedValue(new Error('sentinel lookup failed'));
    const dispatch = vi.fn();
    renderHook(() => useIdbUnlockStartupGuard({ ...options, dispatch }));
    await waitFor(() => expect(mockWarn).toHaveBeenCalled());
    expect(dispatch).not.toHaveBeenCalled();
    expect(mockSetOpen).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith('IDB encryption sentinel check failed during startup', {
      errorType: 'Error',
    });
  });
});
