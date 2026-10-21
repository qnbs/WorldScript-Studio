import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { settingsActions } from '../../../features/settings/settingsSlice';
import { useRestoreDefaultSettings } from '../../../hooks/useRestoreDefaultSettings';

const dispatch = vi.fn();
const success = vi.fn();

vi.mock('../../../app/hooks', () => ({ useAppDispatch: () => dispatch }));
vi.mock('../../../components/ui/Toast', () => ({ useToast: () => ({ success }) }));
vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('useRestoreDefaultSettings (#818)', () => {
  it('resets the settings, closes the dialog and confirms', () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useRestoreDefaultSettings(onDone));
    result.current();
    expect(dispatch).toHaveBeenCalledWith(settingsActions.resetToDefaults());
    expect(onDone).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith('settings.data.dangerZone.settingsReset.done');
  });
});
