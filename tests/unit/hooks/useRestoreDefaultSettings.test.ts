import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { settingsActions } from '../../../features/settings/settingsSlice';
import { useRestoreDefaultSettings } from '../../../hooks/useRestoreDefaultSettings';

describe('useRestoreDefaultSettings (#818)', () => {
  it('resets the settings, closes the dialog and confirms', () => {
    const dispatch = vi.fn();
    const success = vi.fn();
    const setModal = vi.fn();
    const toast = { success } as unknown as Parameters<typeof useRestoreDefaultSettings>[1];
    const { result } = renderHook(() =>
      useRestoreDefaultSettings(dispatch, toast, (key) => key, setModal),
    );
    result.current();
    expect(dispatch).toHaveBeenCalledWith(settingsActions.resetToDefaults());
    expect(setModal).toHaveBeenCalledWith({ state: 'closed', payload: {} });
    expect(success).toHaveBeenCalledWith('settings.data.dangerZone.settingsReset.done');
  });
});
