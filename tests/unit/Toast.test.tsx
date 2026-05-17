import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../components/ui/Toast';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockNotifications = vi.fn(() => [] as unknown[]);
const mockRunCommand = vi.fn();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ status: { notifications: mockNotifications() } }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../contexts/CommandExecutorContext', () => ({
  useCommandExecutor: () => mockRunCommand,
}));

vi.mock('../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((payload: unknown) => ({ type: 'status/addNotification', payload })),
    removeNotification: vi.fn((id: unknown) => ({
      type: 'status/removeNotification',
      payload: id,
    })),
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockNotifications.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

type ToastMsg = {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  actionLabel?: string;
  commandId?: string;
};

// ---------------------------------------------------------------------------
// ToastProvider
// ---------------------------------------------------------------------------

describe('ToastProvider', () => {
  it('renders children', () => {
    render(
      <ToastProvider>
        <span data-testid="child">hi</span>
      </ToastProvider>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('renders aria-live notification region', () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    expect(screen.getByRole('status', { hidden: true })).toBeTruthy();
  });

  it('renders a success toast when notifications contain one', () => {
    const toast: ToastMsg = { id: '1', type: 'success', title: 'Saved!' };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    expect(screen.getByText('Saved!')).toBeTruthy();
  });

  it('renders an error toast', () => {
    const toast: ToastMsg = {
      id: '2',
      type: 'error',
      title: 'Oops',
      description: 'Something failed',
    };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    expect(screen.getByText('Oops')).toBeTruthy();
    expect(screen.getByText('Something failed')).toBeTruthy();
  });

  it('renders an info toast', () => {
    const toast: ToastMsg = { id: '3', type: 'info', title: 'FYI' };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    expect(screen.getByText('FYI')).toBeTruthy();
  });

  it('dispatches removeNotification when close button is clicked', () => {
    const toast: ToastMsg = { id: 'close-me', type: 'info', title: 'Info' };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByLabelText('common.close'));
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('auto-dismisses after 5 seconds', () => {
    const toast: ToastMsg = { id: 'auto-close', type: 'success', title: 'Done' };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('renders action button and calls runCommand on click', () => {
    const toast: ToastMsg = {
      id: 'action-toast',
      type: 'info',
      title: 'Action available',
      actionLabel: 'Open settings',
      commandId: 'openSettings',
    };
    mockNotifications.mockReturnValue([toast]);
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(mockRunCommand).toHaveBeenCalledWith('openSettings');
    expect(mockDispatch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useToast
// ---------------------------------------------------------------------------

describe('useToast', () => {
  it('throws when used outside ToastProvider', () => {
    expect(() => renderHook(() => useToast())).toThrow(
      'useToast must be used within a ToastProvider',
    );
  });

  it('dispatches addNotification for success', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.success('All good');
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('dispatches addNotification for error', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.error('Fail', 'Details');
    });
    expect(mockDispatch).toHaveBeenCalled();
  });

  it('dispatches addNotification for info', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.info('Heads up');
    });
    expect(mockDispatch).toHaveBeenCalled();
  });
});
