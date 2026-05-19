import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();

vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
  useAppSelectorShallow: vi.fn((selector: (s: any) => unknown) =>
    selector({
      plotBoard: {
        connections: [],
        selectedConnectionId: null,
        isDrawingConnection: false,
        drawFromSectionId: null,
        subplots: { ids: [], entities: {} },
        activeMode: 'canvas',
        zoom: 1,
        panX: 0,
        panY: 0,
        snapToGrid: false,
        tensionOverrides: {},
        activeSubplotFilter: null,
      },
    }),
  ),
}));

import { ConnectionLayer } from '../../components/scene-board/ConnectionLayer';

const mockT = (k: string) => k;
const LAYOUT = {
  s1: { x: 0, y: 0 },
  s2: { x: 400, y: 200 },
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
    // Only marker-def paths; no connection paths
    const groups = container.querySelectorAll('g[data-testid="connection-group"]');
    expect(groups.length).toBe(0);
  });

  it('renders a path group for each connection', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [
              { id: 'c1', fromSectionId: 's1', toSectionId: 's2', type: 'cause-effect' },
            ],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: { ids: [], entities: {} },
          },
        }),
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
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [
              {
                id: 'c1',
                fromSectionId: 'missing-a',
                toSectionId: 'missing-b',
                type: 'cause-effect',
              },
            ],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: { ids: [], entities: {} },
          },
        }),
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
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [
              { id: 'c1', fromSectionId: 's1', toSectionId: 's2', type: 'cause-effect' },
            ],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: { ids: [], entities: {} },
          },
        }),
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
    // The hit-test path has stroke="transparent" and pointer-events:stroke
    const hitPath = container.querySelectorAll('path[stroke="transparent"]')[0];
    expect(hitPath).toBeTruthy();
    if (hitPath) fireEvent.click(hitPath);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringContaining('setSelectedConnection') }),
    );
  });

  it('shows draw-mode preview path when isDrawingConnection is true', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [],
            selectedConnectionId: null,
            isDrawingConnection: true,
            drawFromSectionId: 's1',
            subplots: { ids: [], entities: {} },
          },
        }),
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
    // Preview path: stroke-dasharray="8,4"
    const preview = container.querySelector('path[stroke-dasharray="8,4"]');
    expect(preview).toBeTruthy();
  });

  it('does not show preview path when cursorCanvasPos is null', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [],
            selectedConnectionId: null,
            isDrawingConnection: true,
            drawFromSectionId: 's1',
            subplots: { ids: [], entities: {} },
          },
        }),
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
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [
              {
                id: 'c1',
                fromSectionId: 's1',
                toSectionId: 's2',
                type: 'cause-effect',
                label: 'Key link',
              },
            ],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: { ids: [], entities: {} },
          },
        }),
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
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [
              {
                id: 'c1',
                fromSectionId: 's1',
                toSectionId: 's2',
                type: 'cause-effect',
                subplotId: 'sp-1',
              },
            ],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: {
              ids: ['sp-1'],
              entities: {
                'sp-1': { id: 'sp-1', name: 'Love arc', color: '#a855f7', sectionIds: [] },
              },
            },
          },
        }),
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
    // Visible path should use subplot color (#a855f7), not the type default
    const visiblePath = container.querySelector('path[stroke="#a855f7"]');
    expect(visiblePath).toBeTruthy();
  });

  it('uses parallel stroke-dasharray for parallel connection type', async () => {
    const { useAppSelectorShallow } = await import('../../app/hooks');
    vi.mocked(useAppSelectorShallow) // biome-ignore lint/suspicious/noExplicitAny: test mock — required for selector mock assignability
      .mockImplementation((selector: (s: any) => unknown) =>
        selector({
          plotBoard: {
            connections: [{ id: 'c1', fromSectionId: 's1', toSectionId: 's2', type: 'parallel' }],
            selectedConnectionId: null,
            isDrawingConnection: false,
            drawFromSectionId: null,
            subplots: { ids: [], entities: {} },
          },
        }),
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
    // Dashed visible path for parallel type
    const dashedPath = container.querySelector('path[stroke-dasharray="6,3"]');
    expect(dashedPath).toBeTruthy();
  });
});
