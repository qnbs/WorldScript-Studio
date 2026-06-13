import type { MindMapEdge, MindMapNode } from '../../types';

interface Props {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
}

function nodePos(nodes: MindMapNode[], id: string): { x: number; y: number } | null {
  const node = nodes.find((n) => n.id === id);
  return node ? node.position : null;
}

// QNBS-v3: cubic Bézier with mid-point control gives readable curves regardless of node distance
function cubicPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
}

export function MindMapEdgeLayer({ nodes, edges, selectedEdgeId, onSelectEdge }: Props) {
  return (
    <g>
      <defs>
        <marker id="mm-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" className="fill-indigo-500" />
        </marker>
        <marker id="mm-arrow-sel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" className="fill-indigo-400" />
        </marker>
      </defs>

      {edges.map((edge) => {
        const src = nodePos(nodes, edge.sourceNodeId);
        const tgt = nodePos(nodes, edge.targetNodeId);
        if (!src || !tgt) return null;

        const isSelected = edge.id === selectedEdgeId;
        const isDotted = edge.style === 'dotted';
        const isBi = edge.direction === 'bi';
        const d = cubicPath(src.x, src.y, tgt.x, tgt.y);
        // QNBS-v3: selected edge uses the design-system accent token so it adapts to theme/sepia.
        const stroke = isSelected ? 'var(--sc-accent)' : edge.color;

        return (
          // QNBS-v3: the <g> is the interactive element; role=button with keyboard support for a11y
          <g
            key={edge.id}
            data-testid="mindmap-edge"
            role="button"
            tabIndex={0}
            aria-label={edge.label ?? 'edge'}
            aria-pressed={isSelected}
            onClick={() => onSelectEdge(edge.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelectEdge(edge.id);
            }}
            style={{ cursor: 'pointer' }}
          >
            {/* wider invisible hit target */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
            <path
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={isSelected ? 2 : 1.5}
              strokeDasharray={isDotted ? '5 4' : undefined}
              markerEnd={`url(#mm-arrow${isSelected ? '-sel' : ''})`}
              markerStart={isBi ? `url(#mm-arrow${isSelected ? '-sel' : ''})` : undefined}
            />
            {edge.label ? (
              <text
                x={(src.x + tgt.x) / 2}
                y={(src.y + tgt.y) / 2 - 6}
                textAnchor="middle"
                fontSize={10}
                fill={stroke}
                className="select-none pointer-events-none"
              >
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
