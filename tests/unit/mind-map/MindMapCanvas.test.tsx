/**
 * Tests for components/mind-map/MindMapCanvas.tsx
 * QNBS-v3: Mocks MindMapViewContext + child components; tests empty state, SVG rendering,
 *          node count warning, node/edge click delegation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleSelectNode = vi.fn();
const mockHandleSelectEdge = vi.fn();
const mockHandleOpenNodeEditor = vi.fn();
const mockHandlePan = vi.fn();

let mockActiveMindMap: {
  id: string;
  name: string;
  nodes: {
    id: string;
    label: string;
    position: { x: number; y: number };
    type: string;
    shape: string;
    color: string;
  }[];
  edges: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    label: string | undefined;
    color: string;
    direction: string;
    style: string;
  }[];
} | null = null;

vi.mock('../../../contexts/MindMapViewContext', () => ({
  useMindMapViewContext: () => ({
    activeMindMap: mockActiveMindMap,
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedNodeId: null,
    selectedEdgeId: null,
    handleSelectNode: mockHandleSelectNode,
    handleSelectEdge: mockHandleSelectEdge,
    handleOpenNodeEditor: mockHandleOpenNodeEditor,
    handlePan: mockHandlePan,
  }),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// Stub edge layer so it doesn't need real nodes/edges to render
vi.mock('../../../components/mind-map/MindMapEdgeLayer', () => ({
  MindMapEdgeLayer: ({ edges }: { edges: unknown[] }) => (
    <g data-testid="edge-layer" data-edge-count={edges.length} />
  ),
}));

// Stub node shape
vi.mock('../../../components/mind-map/MindMapNodeShape', () => ({
  MindMapNodeShape: ({
    node,
    onClick,
    onDoubleClick,
  }: {
    node: { id: string; label: string };
    onClick: () => void;
    onDoubleClick: () => void;
  }) => (
    // biome-ignore lint/a11y/useSemanticElements: SVG mock — <g> is valid inside SVG; <button> is not
    <g
      data-testid={`node-shape-${node.id}`}
      role="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {node.label}
    </g>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MindMapCanvas } from '../../../components/mind-map/MindMapCanvas';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMapCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveMindMap = null;
  });

  it('shows empty state message when no active mind map', () => {
    render(<MindMapCanvas />);
    expect(screen.getByText('mindmap.emptyState')).toBeInTheDocument();
  });

  it('renders SVG when mind map is active', () => {
    mockActiveMindMap = { id: 'mm-1', name: 'My Map', nodes: [], edges: [] };
    const { container } = render(<MindMapCanvas />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('SVG has aria-label from mind map name', () => {
    mockActiveMindMap = { id: 'mm-1', name: 'Story Map', nodes: [], edges: [] };
    const { container } = render(<MindMapCanvas />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Story Map');
  });

  it('renders node shapes for each node', () => {
    mockActiveMindMap = {
      id: 'mm-1',
      name: 'Map',
      nodes: [
        {
          id: 'n1',
          label: 'Node A',
          position: { x: 100, y: 100 },
          type: 'free',
          shape: 'rectangle',
          color: '#fff',
        },
        {
          id: 'n2',
          label: 'Node B',
          position: { x: 200, y: 200 },
          type: 'free',
          shape: 'circle',
          color: '#fff',
        },
      ],
      edges: [],
    };
    render(<MindMapCanvas />);
    expect(screen.getByTestId('node-shape-n1')).toBeInTheDocument();
    expect(screen.getByTestId('node-shape-n2')).toBeInTheDocument();
  });

  it('shows node count warning when over 500 nodes', () => {
    const nodes = Array.from({ length: 501 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
      position: { x: i * 10, y: 0 },
      type: 'free',
      shape: 'rectangle',
      color: '#fff',
    }));
    mockActiveMindMap = { id: 'mm-1', name: 'Big Map', nodes, edges: [] };
    render(<MindMapCanvas />);
    expect(screen.getByRole('alert')).toHaveTextContent('mindmap.nodeCountWarning');
  });

  it('does not show warning when under 500 nodes', () => {
    mockActiveMindMap = { id: 'mm-1', name: 'Small Map', nodes: [], edges: [] };
    render(<MindMapCanvas />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('calls handleSelectNode with node id when node is clicked', async () => {
    const user = userEvent.setup();
    mockActiveMindMap = {
      id: 'mm-1',
      name: 'Map',
      nodes: [
        {
          id: 'n1',
          label: 'Node A',
          position: { x: 0, y: 0 },
          type: 'free',
          shape: 'rectangle',
          color: '#fff',
        },
      ],
      edges: [],
    };
    render(<MindMapCanvas />);
    await user.click(screen.getByTestId('node-shape-n1'));
    expect(mockHandleSelectNode).toHaveBeenCalledWith('n1');
  });

  it('calls handleOpenNodeEditor when node is double-clicked', async () => {
    const user = userEvent.setup();
    mockActiveMindMap = {
      id: 'mm-1',
      name: 'Map',
      nodes: [
        {
          id: 'n1',
          label: 'Node A',
          position: { x: 0, y: 0 },
          type: 'free',
          shape: 'rectangle',
          color: '#fff',
        },
      ],
      edges: [],
    };
    render(<MindMapCanvas />);
    await user.dblClick(screen.getByTestId('node-shape-n1'));
    expect(mockHandleOpenNodeEditor).toHaveBeenCalledWith('n1');
  });
});
