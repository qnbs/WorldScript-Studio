import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

const makeMockState = (overrides?: {
  subplots?: { ids: string[]; entities: Record<string, unknown> };
  activeSubplotFilter?: string | null;
}) => ({
  plotBoard: {
    subplots: overrides?.subplots ?? { ids: [], entities: {} },
    activeSubplotFilter: overrides?.activeSubplotFilter ?? null,
    connections: [],
    selectedConnectionId: null,
    isDrawingConnection: false,
    drawFromSectionId: null,
    activeMode: 'canvas',
    zoom: 1,
    panX: 0,
    panY: 0,
    snapToGrid: false,
    tensionOverrides: {},
  },
});

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) => selector(makeMockState())),
}));

import { SubplotPanel } from '../../components/scene-board/SubplotPanel';

const mockT = (k: string) => k;
const mockSections = [
  { id: 's1', title: 'Opening', content: '', color: '#3b82f6', status: 'draft' as const },
  { id: 's2', title: 'Rising Action', content: '', color: '#8b5cf6', status: 'outline' as const },
];

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
    // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: any) => unknown) =>
      selector(
        makeMockState({
          subplots: {
            ids: ['sp-1'],
            entities: {
              'sp-1': { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] },
            },
          },
        }),
      ),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('Love arc')).toBeTruthy();
  });

  it('shows add subplot button', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    expect(screen.getByText('sceneboard.subplot.addSubplot')).toBeTruthy();
  });

  it('dispatches addSubplot when submitted', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    fireEvent.click(screen.getByText('sceneboard.subplot.addSubplot'));
    // Enter a name
    const input = screen.getByPlaceholderText('sceneboard.subplot.namePlaceholder');
    fireEvent.change(input, { target: { value: 'Mystery arc' } });
    fireEvent.click(screen.getByText('common.add'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('addSubplot') }),
    );
  });

  it('dispatches setActiveSubplotFilter when filter button clicked', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: any) => unknown) =>
      selector(
        makeMockState({
          subplots: {
            ids: ['sp-1'],
            entities: {
              'sp-1': { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] },
            },
          },
        }),
      ),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    // Clicking the subplot name toggles the filter
    fireEvent.click(screen.getByText('Love arc'));
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('setActiveSubplotFilter') }),
    );
  });

  it('dispatches deleteSubplot when delete button clicked', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: any) => unknown) =>
      selector(
        makeMockState({
          subplots: {
            ids: ['sp-1'],
            entities: {
              'sp-1': { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] },
            },
          },
        }),
      ),
    );

    render(<SubplotPanel sections={mockSections} t={mockT} />);
    // Delete button is in a group-hover element; we can still click it
    const deleteBtn = screen.getByLabelText('sceneboard.subplot.delete Love arc');
    fireEvent.click(deleteBtn);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('deleteSubplot') }),
    );
  });

  it('collapses to thin strip when collapse button is clicked', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    const collapseBtn = screen.getByLabelText('sceneboard.subplot.collapsePanel');
    fireEvent.click(collapseBtn);
    // In collapsed state, expand button appears
    expect(screen.getByLabelText('sceneboard.subplot.expandPanel')).toBeTruthy();
  });

  it('expands from collapsed state', () => {
    render(<SubplotPanel sections={mockSections} t={mockT} />);
    const collapseBtn = screen.getByLabelText('sceneboard.subplot.collapsePanel');
    fireEvent.click(collapseBtn);
    const expandBtn = screen.getByLabelText('sceneboard.subplot.expandPanel');
    fireEvent.click(expandBtn);
    // Title should reappear
    expect(screen.getByText('sceneboard.subplot.title')).toBeTruthy();
  });
});
