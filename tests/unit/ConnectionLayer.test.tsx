import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RootState } from '../../app/store';
import type { PlotConnection, Subplot } from '../../types';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

// QNBS-v3: connections/subplots moved to projectSlice (undo-able). plotBoard is viewport-only.
const makeMockState = (overrides?: {
  connections?: PlotConnection[];
  subplots?: Subplot[];
  isDrawingConnection?: boolean;
  drawFromSectionId?: string | null;
  selectedConnectionId?: string | null;
}) =>
  ({
    project: {
      present: {
        data: {
          manuscript: [],
          plotConnections: overrides?.connections ?? [],
          plotSubplots: overrides?.subplots ?? [],
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
      selectedConnectionId: overrides?.selectedConnectionId ?? null,
      isDrawingConnection: overrides?.isDrawingConnection ?? false,
      drawFromSectionId: overrides?.drawFromSectionId ?? null,
      activeMode: 'canvas',
      activeSubplotFilter: null,
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

import { ConnectionLayer } from '../../components/scene-board/ConnectionLayer';

const mockT = (k: string) => k;
const LAYOUT = {
  s1: { x: 0, y: 0 },
  s2: { x: 400, y: 200 },
};

const conn1: PlotConnection = {
  id: 'c1',
  fromSectionId: 's1',
  toSectionId: 's2',
  type: 'cause-effect',
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ConnectionLayer', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('has role="img" with aria-label on the SVG', () => {
    render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const svg = screen.getByRole('img', { hidden: true });
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders no paths when there are no connections', () => {
    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const groups = container.querySelectorAll('g[data-testid="connection-group"]');
    expect(groups.length).toBe(0);
  });

  it('renders a path group for each connection', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ connections: [conn1] })),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const groups = container.querySelectorAll('g[data-testid="connection-group"]');
    expect(groups.length).toBe(1);
  });

  it('skips connections whose section positions are missing from layout', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(
        makeMockState({
          connections: [
            {
              id: 'c1',
              fromSectionId: 'missing-a',
              toSectionId: 'missing-b',
              type: 'cause-effect',
            },
          ],
        }),
      ),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const groups = container.querySelectorAll('g[data-testid="connection-group"]');
    expect(groups.length).toBe(0);
  });

  it('dispatches setSelectedConnection when a hit-test path is clicked', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ connections: [conn1] })),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const hitPath = container.querySelectorAll('path[stroke="transparent"]')[0];
    expect(hitPath).toBeTruthy();
    if (hitPath) fireEvent.click(hitPath);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('setSelectedConnection') }),
    );
  });

  it('shows draw-mode preview path when isDrawingConnection is true', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ isDrawingConnection: true, drawFromSectionId: 's1' })),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={{ x: 300, y: 150 }}
        t={mockT}
      />,
    );
    const preview = container.querySelector('path[stroke-dasharray="8,4"]');
    expect(preview).toBeTruthy();
  });

  it('does not show preview path when cursorCanvasPos is null', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ isDrawingConnection: true, drawFromSectionId: 's1' })),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const preview = container.querySelector('path[stroke-dasharray="8,4"]');
    expect(preview).toBeFalsy();
  });

  it('renders label text when connection has a label', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(
        makeMockState({
          connections: [{ ...conn1, label: 'Key link' }],
        }),
      ),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const label = container.querySelector('text');
    expect(label?.textContent).toBe('Key link');
  });

  it('uses subplot color when connection has subplotId', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    const subplot: Subplot = { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] };
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(
        makeMockState({
          connections: [{ ...conn1, subplotId: 'sp-1' }],
          subplots: [subplot],
        }),
      ),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const visiblePath = container.querySelector('path[stroke="#a855f7"]');
    expect(visiblePath).toBeTruthy();
  });

  it('uses parallel stroke-dasharray for parallel connection type', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow).mockImplementation((selector: (s: RootState) => unknown) =>
      selector(makeMockState({ connections: [{ ...conn1, type: 'parallel' }] })),
    );

    const { container } = render(
      <ConnectionLayer
        layout={LAYOUT}
        canvasW={2400}
        canvasH={1600}
        cursorCanvasPos={null}
        t={mockT}
      />,
    );
    const dashedPath = container.querySelector('path[stroke-dasharray="6,3"]');
    expect(dashedPath).toBeTruthy();
  });
});
