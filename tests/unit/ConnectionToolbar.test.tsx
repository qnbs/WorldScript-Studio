/**
 * Tests for components/scene-board/ConnectionToolbar.tsx
 * QNBS-v3: Tests null return when no selection, type change, label commit, delete, and deselect.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
let mockSelectedId: string | null = null;
let mockConnections: { id: string; type: string; label?: string }[] = [];

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useAppSelectorShallow: (selector: (s: any) => unknown) =>
    selector({
      plotBoard: {
        selectedConnectionId: mockSelectedId,
        activeMode: 'swimlane',
        snapToGrid: false,
        isDrawingConnection: false,
        drawFromSectionId: null,
        activeSubplotFilter: null,
        zoom: 1,
        panX: 0,
        panY: 0,
      },
      project: {
        present: {
          data: {
            plotConnections: mockConnections,
          },
        },
      },
    }),
}));

vi.mock('../../features/plotBoard/plotBoardSlice', () => ({
  plotBoardActions: {
    setSelectedConnection: vi.fn((id) => ({
      type: 'plotBoard/setSelectedConnection',
      payload: id,
    })),
  },
  selectSelectedConnectionId: (s: { plotBoard: { selectedConnectionId: string | null } }) =>
    s.plotBoard.selectedConnectionId,
}));

vi.mock('../../features/project/projectSelectors', () => ({
  selectPlotConnections: (s: { project: { present: { data: { plotConnections: unknown[] } } } }) =>
    s.project.present.data.plotConnections ?? [],
}));

vi.mock('../../features/project/projectSlice', () => ({
  projectActions: {
    updatePlotConnection: vi.fn((p) => ({ type: 'project/updatePlotConnection', payload: p })),
    removePlotConnection: vi.fn((id) => ({ type: 'project/removePlotConnection', payload: id })),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ConnectionToolbar } from '../../components/scene-board/ConnectionToolbar';

const t = (k: string) => k;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedId = null;
    mockConnections = [];
  });

  it('renders nothing when no connection is selected', () => {
    const { container } = render(<ConnectionToolbar t={t} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders toolbar when a connection is selected', () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    render(<ConnectionToolbar t={t} />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });

  it('shows all connection type buttons', () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    render(<ConnectionToolbar t={t} />);
    expect(screen.getByText('→')).toBeInTheDocument();
    expect(screen.getByText('∥')).toBeInTheDocument();
    expect(screen.getByText('♡')).toBeInTheDocument();
  });

  it('dispatches updatePlotConnection when type button clicked', async () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    const user = userEvent.setup();
    render(<ConnectionToolbar t={t} />);
    await user.click(screen.getByText('∥')); // parallel
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { id: 'conn-1', changes: { type: 'parallel' } } }),
    );
  });

  it('dispatches removePlotConnection when delete button clicked', async () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    const user = userEvent.setup();
    render(<ConnectionToolbar t={t} />);
    await user.click(screen.getByRole('button', { name: 'sceneboard.connectionToolbar.delete' }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: 'conn-1' }));
  });

  it('dispatches setSelectedConnection(null) when × clicked', async () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    const user = userEvent.setup();
    render(<ConnectionToolbar t={t} />);
    await user.click(screen.getByRole('button', { name: 'sceneboard.connectionToolbar.close' }));
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: null }));
  });

  it('label input pre-fills from connection label', () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect', label: 'My Label' }];
    render(<ConnectionToolbar t={t} />);
    const input = screen.getByRole('textbox');
    expect((input as HTMLInputElement).value).toBe('My Label');
  });

  it('commits label on Enter key', async () => {
    mockSelectedId = 'conn-1';
    mockConnections = [{ id: 'conn-1', type: 'cause-effect' }];
    const user = userEvent.setup();
    render(<ConnectionToolbar t={t} />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'New Label{Enter}');
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { id: 'conn-1', changes: { label: 'New Label' } } }),
    );
  });
});
