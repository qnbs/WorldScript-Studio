import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetOpen, mockHasSentinel } = vi.hoisted(() => ({
  mockSetOpen: vi.fn(),
  mockHasSentinel: vi.fn(),
}));

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: (selector: (state: { setIdbUnlockOpen: typeof mockSetOpen }) => unknown) =>
    selector({ setIdbUnlockOpen: mockSetOpen }),
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  hasPassphraseSentinel: mockHasSentinel,
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
});
