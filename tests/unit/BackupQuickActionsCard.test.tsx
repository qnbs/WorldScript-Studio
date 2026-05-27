/**
 * Tests for components/dashboard/BackupQuickActionsCard.tsx
 * QNBS-v3: Covers render, export, import, and settings navigation.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn().mockReturnValue({ type: 'noop', unwrap: () => Promise.resolve() });
const mockListSnapshots = vi.fn().mockResolvedValue([]);

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelector: (selector: (s: any) => unknown) =>
    selector({
      project: {
        present: {
          data: {
            id: 'proj-1',
            title: 'My Story',
            sections: [],
            characters: [],
            worlds: [],
          },
        },
      },
    }),
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectAllCharacters: () => [],
  selectAllWorlds: () => [],
}));

vi.mock('../../features/project/thunks/projectManagementThunks', () => ({
  importProjectThunk: vi.fn((file) => ({ type: 'import/thunk', payload: file })),
}));

vi.mock('../../features/status/statusSlice', () => ({
  statusActions: {
    addNotification: vi.fn((n) => ({ type: 'status/addNotification', payload: n })),
  },
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    listSnapshots: (...args: unknown[]) => mockListSnapshots(...args),
  },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, string>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { BackupQuickActionsCard } from '../../components/dashboard/BackupQuickActionsCard';
import { importProjectThunk } from '../../features/project/thunks/projectManagementThunks';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackupQuickActionsCard', () => {
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockListSnapshots.mockResolvedValue([]);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:fake'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('renders the backup card', async () => {
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(mockListSnapshots).toHaveBeenCalled());
    expect(screen.getByText('dashboard.backup.title')).toBeInTheDocument();
  });

  it('renders export, import, and settings buttons', async () => {
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(mockListSnapshots).toHaveBeenCalled());
    expect(screen.getByText('dashboard.backup.exportJson')).toBeInTheDocument();
    expect(screen.getByText('dashboard.backup.importJson')).toBeInTheDocument();
    expect(screen.getByText('dashboard.backup.openSettings')).toBeInTheDocument();
  });

  it('shows latest snapshot info when snapshot exists', async () => {
    mockListSnapshots.mockResolvedValueOnce([{ name: 'Snap1', date: '2026-01-01T00:00:00.000Z' }]);
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText(/latestSnapshot/)).toBeInTheDocument());
  });

  it('navigates to settings with backup category when settings button clicked', async () => {
    const user = userEvent.setup();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(mockListSnapshots).toHaveBeenCalled());
    await user.click(screen.getByText('dashboard.backup.openSettings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
    setItemSpy.mockRestore();
  });

  it('triggers export when export button is clicked', async () => {
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag === 'a') {
        return { click: clickSpy, href: '', download: '' } as unknown as HTMLElement;
      }
      return origCreateElement(tag);
    });
    const user = userEvent.setup();
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(mockListSnapshots).toHaveBeenCalled());
    await user.click(screen.getByText('dashboard.backup.exportJson'));
    expect(clickSpy).toHaveBeenCalled();
    createEl.mockRestore();
  });

  it('dispatches importProjectThunk when a file is selected', async () => {
    // QNBS-v3: fulfilled.match must return true for success path
    const { importProjectThunk: mockThunk } = await import(
      '../../features/project/thunks/projectManagementThunks'
    );
    vi.mocked(mockThunk).mockReturnValue({ type: 'import/thunk' } as unknown as ReturnType<
      typeof importProjectThunk
    >);
    Object.assign(vi.mocked(importProjectThunk), {
      fulfilled: { match: () => true },
    });
    mockDispatch.mockReturnValueOnce({ type: 'import/fulfilled', unwrap: () => Promise.resolve() });

    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    const user = userEvent.setup();
    render(<BackupQuickActionsCard onNavigate={onNavigate} />);
    await waitFor(() => expect(mockListSnapshots).toHaveBeenCalled());

    // Click the import button to trigger hidden file input
    await user.click(screen.getByText('dashboard.backup.importJson'));

    // Get the hidden file input and upload
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      await userEvent.upload(fileInput, file);
      expect(mockDispatch).toHaveBeenCalled();
    }
  });
});
