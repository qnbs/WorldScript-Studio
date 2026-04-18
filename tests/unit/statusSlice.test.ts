import { describe, expect, it, vi } from 'vitest';
import reducer, { type StatusState, statusActions } from '../../features/status/statusSlice';

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-id'),
}));

describe('statusSlice', () => {
  it('has the expected initial state', () => {
    const state = reducer(undefined, { type: '@@INIT' });

    expect(state).toEqual<StatusState>({
      saving: 'idle',
      notifications: [],
    });
  });

  it('updates the saving status', () => {
    const state = reducer(undefined, statusActions.setSavingStatus('saving'));

    expect(state.saving).toBe('saving');
  });

  it('adds notifications with generated id when omitted', () => {
    const state = reducer(
      undefined,
      statusActions.addNotification({
        type: 'info',
        title: 'Info title',
        description: 'Info description',
      }),
    );

    expect(state.notifications).toEqual([
      {
        id: 'generated-id',
        type: 'info',
        title: 'Info title',
        description: 'Info description',
      },
    ]);
  });

  it('keeps a provided notification id', () => {
    const state = reducer(
      undefined,
      statusActions.addNotification({
        id: 'custom-id',
        type: 'success',
        title: 'Saved',
      }),
    );

    expect(state.notifications[0]?.id).toBe('custom-id');
  });

  it('removes notifications by id', () => {
    const withFirst = reducer(
      undefined,
      statusActions.addNotification({ id: 'first-id', type: 'success', title: 'First' }),
    );

    const withSecond = reducer(
      withFirst,
      statusActions.addNotification({ id: 'second-id', type: 'error', title: 'Second' }),
    );

    const cleaned = reducer(withSecond, statusActions.removeNotification('first-id'));

    expect(cleaned.notifications).toHaveLength(1);
    expect(cleaned.notifications[0]?.id).toBe('second-id');
  });
});
