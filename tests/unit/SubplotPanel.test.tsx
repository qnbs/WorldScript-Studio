import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../app/store';
import type { Subplot } from '../../types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

// QNBS-v3: subplots moved to projectSlice (undo-able); activeSubplotFilter stays in plotBoard.
const makeMockState = (overrides?: {
  plotSubplots?: Subplot[];
  activeSubplotFilter?: string | null;
}) =>
  ({
    project: {
      present: {
        data: {
          manuscript: [],
          plotSubplots: overrides?.plotSubplots ?? [],
          plotConnections: [],
          plotTensionOverrides: {},
          characters: { ids: [], entities: {} },
          worlds: { ids: [], entities: {} },
          outline: [],
          logline: '',
          title: '',
        },
      },
    },
    plotBoard: {
      activeSubplotFilter: overrides?.activeSubplotFilter ?? null,
      selectedConnectionId: null,
      isDrawingConnection: false,
      drawFromSectionId: null,
      activeMode: 'canvas',
      zoom: 1,
      panX: 0,
      panY: 0,
      snapToGrid: false,
    },
  }) as unknown as RootState;

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelectorShallow: vi.fn((selector: (s: RootState) => unknown) => selector(makeMockState())),
}));

import { SubplotPanel } from '../../components/scene-board/SubplotPanel';

const mockT = (k: string) => k;
const mockSections = [
  { id: 's1', title: 'Opening', content: '', color: '#3b82f6', status: 'draft' as const },
  { id: 's2', title: 'Rising Action', content: '', color: '#8b5cf6', status: 'outline' as const },
];

const mockSubplot: Subplot = { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] };

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDispatch.mockClear();
});

describe('SubplotPanel', () => {
  it('renders the panel with title', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('sceneboard.subplot.title')).toBeTruthy();
  });

  it('shows empty state when no subplots exist', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('sceneboard.subplot.empty')).toBeTruthy();
  });

  it('renders subplot rows when subplots exist', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ plotSubplots: [mockSubplot] })),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('Love arc')).toBeTruthy();
  });

  it('shows add subplot button', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('sceneboard.subplot.addSubplot')).toBeTruthy();
  });

  it('dispatches addPlotSubplot when submitted', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    fireEvent.click(screen.getByText('sceneboard.subplot.addSubplot'));
    const input = screen.getByPlaceholderText('sceneboard.subplot.namePlaceholder');
    fireEvent.change(input, { target: { value: 'Mystery arc' } });
    fireEvent.click(screen.getByText('common.add'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/addPlotSubplot' }),
    );
  });

  it('dispatches setActiveSubplotFilter when filter button clicked', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ plotSubplots: [mockSubplot] })),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    fireEvent.click(screen.getByText('Love arc'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('setActiveSubplotFilter') }),
    );
  });

  it('dispatches deletePlotSubplot when delete button clicked', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ plotSubplots: [mockSubplot] })),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    const deleteBtn = screen.getByLabelText('sceneboard.subplot.delete Love arc');
    fireEvent.click(deleteBtn);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'project/deletePlotSubplot' }),
    );
  });

  it('collapses to thin strip when collapse button is clicked', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    const collapseBtn = screen.getByLabelText('sceneboard.subplot.collapsePanel');
    fireEvent.click(collapseBtn);
    expect(screen.getByLabelText('sceneboard.subplot.expandPanel')).toBeTruthy();
  });

  it('expands from collapsed state', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    const collapseBtn = screen.getByLabelText('sceneboard.subplot.collapsePanel');
    fireEvent.click(collapseBtn);
    const expandBtn = screen.getByLabelText('sceneboard.subplot.expandPanel');
    fireEvent.click(expandBtn);
    expect(screen.getByText('sceneboard.subplot.title')).toBeTruthy();
  });
});
