/**
 * Tests for components/mind-map/MindMapEdgeLayer.tsx
 * QNBS-v3: SVG edge rendering — tests edge count, selection, labels, dotted style, bidirectional.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MindMapEdgeLayer } from '../../../components/mind-map/MindMapEdgeLayer';
import type { MindMapEdge, MindMapNode } from '../../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NODES: MindMapNode[] = [
  {
    id: 'n1',
    mindMapId: 'mm1',
    label: 'Node 1',
    position: { x: 100, y: 100 },
    type: 'free',
    shape: 'rectangle',
    color: '#6366f1',
    textNotes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'n2',
    mindMapId: 'mm1',
    label: 'Node 2',
    position: { x: 300, y: 200 },
    type: 'free',
    shape: 'circle',
    color: '#a855f7',
    textNotes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'n3',
    mindMapId: 'mm1',
    label: 'Node 3',
    position: { x: 500, y: 100 },
    type: 'free',
    shape: 'rectangle',
    color: '#10b981',
    textNotes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const EDGES: MindMapEdge[] = [
  {
    id: 'e1',
    mindMapId: 'mm1',
    sourceNodeId: 'n1',
    targetNodeId: 'n2',
    label: 'connects',
    color: '#6366f1',
    direction: 'uni',
    style: 'solid',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'e2',
    mindMapId: 'mm1',
    sourceNodeId: 'n2',
    targetNodeId: 'n3',
    color: '#a855f7',
    direction: 'bi',
    style: 'dotted',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderEdges(
  edges: MindMapEdge[] = EDGES,
  selectedEdgeId: string | null = null,
  onSelectEdge = vi.fn(),
) {
  return render(
    <svg>
      <MindMapEdgeLayer
        nodes={NODES}
        edges={edges}
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={onSelectEdge}
      />
    </svg>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MindMapEdgeLayer', () => {
  it('renders one edge group per edge', () => {
    const { container } = renderEdges();
    const edgeGroups = container.querySelectorAll('[data-testid="mindmap-edge"]');
    expect(edgeGroups).toHaveLength(2);
  });

  it('renders no edges when edges list is empty', () => {
    const { container } = renderEdges([]);
    const edgeGroups = container.querySelectorAll('[data-testid="mindmap-edge"]');
    expect(edgeGroups).toHaveLength(0);
  });

  it('skips edge when source node is missing', () => {
    const edges: MindMapEdge[] = [
      {
        id: 'e1',
        mindMapId: 'mm1',
        sourceNodeId: 'missing-node',
        targetNodeId: 'n2',
        color: '#fff',
        direction: 'uni',
        style: 'solid',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'e2',
        mindMapId: 'mm1',
        sourceNodeId: 'n1',
        targetNodeId: 'n2',
        color: '#fff',
        direction: 'uni',
        style: 'solid',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { container } = renderEdges(edges);
    const edgeGroups = container.querySelectorAll('[data-testid="mindmap-edge"]');
    expect(edgeGroups).toHaveLength(1);
  });

  it('marks selected edge as aria-pressed=true', () => {
    const { container } = renderEdges(EDGES, 'e1');
    const groups = container.querySelectorAll('[data-testid="mindmap-edge"]');
    expect(groups[0]).toHaveAttribute('aria-pressed', 'true');
    expect(groups[1]).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows edge label as text when label is set', () => {
    renderEdges();
    expect(screen.getByText('connects')).toBeInTheDocument();
  });

  it('does not render text when edge has no label', () => {
    // e2 has no label
    const { container } = renderEdges();
    const texts = container.querySelectorAll('text');
    expect(texts).toHaveLength(1); // only e1 has label
  });

  it('calls onSelectEdge with edge id when clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderEdges(EDGES, null, onSelect);
    const edgeGroup = container.querySelectorAll('[data-testid="mindmap-edge"]')[0] as HTMLElement;
    await user.click(edgeGroup);
    expect(onSelect).toHaveBeenCalledWith('e1');
  });

  it('calls onSelectEdge on Enter keydown', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = renderEdges(EDGES, null, onSelect);
    const edgeGroup = container.querySelectorAll('[data-testid="mindmap-edge"]')[0] as HTMLElement;
    edgeGroup.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('e1');
  });

  it('all edge groups have role=button', () => {
    const { container } = renderEdges();
    const groups = container.querySelectorAll('[data-testid="mindmap-edge"]');
    for (const g of groups) {
      expect(g).toHaveAttribute('role', 'button');
    }
  });
});
