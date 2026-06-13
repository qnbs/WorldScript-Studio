import type { MindMapNode } from '../../types';

interface Props {
  node: MindMapNode;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

const W = 120;
const H = 48;
const R = H / 2;

// QNBS-v3: each branch renders an SVG primitive matching the node's shape config
function ShapeBody({
  shape,
  color,
  isSelected,
}: {
  shape: MindMapNode['shape'];
  color: string;
  isSelected: boolean;
}) {
  // QNBS-v3: selection stroke uses the design-system accent token so it adapts to theme/sepia.
  // Fill opacity replaces the old hex-alpha suffix so CSS variables (var(--sc-data-*)) remain valid.
  const stroke = isSelected ? 'var(--sc-accent)' : color;
  const strokeW = isSelected ? 2.5 : 1.5;
  const fillOpacity = 0.13;

  switch (shape) {
    case 'circle':
      return (
        <ellipse
          cx={W / 2}
          cy={H / 2}
          rx={R}
          ry={R}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    case 'rectangle':
      return (
        <rect
          x={2}
          y={2}
          width={W - 4}
          height={H - 4}
          rx={4}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    case 'diamond': {
      const cx = W / 2;
      const cy = H / 2;
      const dx = W / 2 - 4;
      const dy = H / 2 - 2;
      const pts = `${cx},${cy - dy} ${cx + dx},${cy} ${cx},${cy + dy} ${cx - dx},${cy}`;
      return (
        <polygon
          points={pts}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    }
    case 'ellipse':
      return (
        <ellipse
          cx={W / 2}
          cy={H / 2}
          rx={W / 2 - 4}
          ry={H / 2 - 4}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    case 'hexagon': {
      const cx = W / 2;
      const cy = H / 2;
      const a = H / 2 - 2;
      const b = W / 2 - 4;
      const pts = [
        [cx - b, cy],
        [cx - b / 2, cy - a],
        [cx + b / 2, cy - a],
        [cx + b, cy],
        [cx + b / 2, cy + a],
        [cx - b / 2, cy + a],
      ]
        .map((p) => p.join(','))
        .join(' ');
      return (
        <polygon
          points={pts}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
    }
    default:
      return (
        <rect
          x={2}
          y={2}
          width={W - 4}
          height={H - 4}
          rx={4}
          fill={color}
          fillOpacity={fillOpacity}
          stroke={stroke}
          strokeWidth={strokeW}
        />
      );
  }
}

export function MindMapNodeShape({ node, isSelected, onClick, onDoubleClick }: Props) {
  // QNBS-v3: node.position holds canvas coords; center by subtracting half the node size
  return (
    <g
      transform={`translate(${node.position.x - W / 2}, ${node.position.y - H / 2})`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label={node.label}
      aria-pressed={isSelected}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
        if (e.key === 'F2') onDoubleClick();
      }}
    >
      <ShapeBody shape={node.shape} color={node.color} isSelected={isSelected} />
      <text
        x={W / 2}
        y={H / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fill="currentColor"
        className="select-none pointer-events-none"
      >
        {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
      </text>
    </g>
  );
}
