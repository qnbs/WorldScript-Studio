// QNBS-v3: SVG overlay rendered inside the transformed canvas div — coordinates are in canvas-space,
//          matching card positions directly without needing to invert the transform.
import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../../app/hooks';
import {
  plotBoardActions,
  selectDrawFromSectionId,
  selectIsDrawingConnection,
  selectSelectedConnectionId,
} from '../../features/plotBoard/plotBoardSlice';
import { selectPlotConnections, selectPlotSubplots } from '../../features/project/projectSelectors';
import type { PlotConnectionType } from '../../types';

const CARD_W = 200;
const CARD_H = 130;

// ── Connection type visual metadata ───────────────────────────────────────────

const TYPE_COLORS: Record<PlotConnectionType, string> = {
  'cause-effect': '#ef4444',
  parallel: '#3b82f6',
  subplot: '#8b5cf6',
  temporal: '#f59e0b',
  'character-arc': '#10b981',
};

const CONNECTION_TYPES: PlotConnectionType[] = [
  'cause-effect',
  'parallel',
  'subplot',
  'temporal',
  'character-arc',
];

// ── Path helpers ──────────────────────────────────────────────────────────────

function cardCenter(pos: { x: number; y: number }): { x: number; y: number } {
  return { x: pos.x + CARD_W / 2, y: pos.y + CARD_H / 2 };
}

function bezierPath(
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  type: PlotConnectionType,
): string {
  const mx = (sx + dx) / 2;
  const my = (sy + dy) / 2;
  const dist = Math.hypot(dx - sx, dy - sy);
  const bow = Math.min(dist * 0.35, 120);

  if (type === 'parallel') {
    // Horizontal S-curve
    return `M ${sx},${sy} C ${mx},${sy} ${mx},${dy} ${dx},${dy}`;
  }
  // Default: curve with vertical bow offset
  const cpY = my - bow;
  return `M ${sx},${sy} C ${sx},${cpY} ${dx},${cpY} ${dx},${dy}`;
}

// ── Marker defs ───────────────────────────────────────────────────────────────

const ArrowMarkers: FC = () => (
  <defs>
    {CONNECTION_TYPES.map((type) => (
      <marker
        key={type}
        id={`pb-arrow-${type}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 10 5 L 0 10 z" fill={TYPE_COLORS[type]} />
      </marker>
    ))}
    <marker
      id="pb-arrow-selected"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sc-accent-primary,#6366f1)" />
    </marker>
    <marker
      id="pb-arrow-preview"
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--sc-text-muted,#9ca3af)" />
    </marker>
  </defs>
);

// ── Main component ────────────────────────────────────────────────────────────

export interface ConnectionLayerProps {
  layout: Record<string, { x: number; y: number }>;
  canvasW: number;
  canvasH: number;
  /** Cursor position in canvas-space for draw-mode preview. */
  cursorCanvasPos: { x: number; y: number } | null;
  t: (key: string) => string;
}

export const ConnectionLayer: FC<ConnectionLayerProps> = ({
  layout,
  canvasW,
  canvasH,
  cursorCanvasPos,
  t,
}) => {
  const dispatch = useAppDispatch();
  const connections = useAppSelectorShallow(selectPlotConnections);
  const selectedId = useAppSelectorShallow(selectSelectedConnectionId);
  const isDrawing = useAppSelectorShallow(selectIsDrawingConnection);
  const drawFromId = useAppSelectorShallow(selectDrawFromSectionId);
  const subplots = useAppSelectorShallow(selectPlotSubplots);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const subplotColorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const sp of subplots) m.set(sp.id, sp.color);
    return m;
  }, [subplots]);

  const handleSelect = useCallback(
    (id: string) => {
      dispatch(plotBoardActions.setSelectedConnection(id === selectedId ? null : id));
    },
    [dispatch, selectedId],
  );

  const ariaLabel =
    connections.length === 0
      ? t('sceneboard.canvas.noConnections')
      : `${connections.length} ${t('sceneboard.canvas.connections')}`;

  const drawFromPos = drawFromId ? (layout[drawFromId] ?? null) : null;
  const drawFromCenter = drawFromPos ? cardCenter(drawFromPos) : null;

  return (
    // QNBS-v3: pointer-events:none on SVG root lets pan/drag events fall through to the canvas,
    //          while individual hit-test paths override with pointer-events:stroke (SVG spec).
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: canvasW,
        height: canvasH,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
      role="img"
      aria-label={ariaLabel}
    >
      <ArrowMarkers />

      {connections.map((conn) => {
        const fromPos = layout[conn.fromSectionId] ?? null;
        const toPos = layout[conn.toSectionId] ?? null;
        if (!fromPos || !toPos) return null;

        const from = cardCenter(fromPos);
        const to = cardCenter(toPos);
        const d = bezierPath(from.x, from.y, to.x, to.y, conn.type);
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2 - 14;

        const isSelected = conn.id === selectedId;
        const isHovered = conn.id === hoveredId;
        const typeColor = TYPE_COLORS[conn.type];
        const strokeColor = isSelected
          ? 'var(--sc-accent-primary,#6366f1)'
          : conn.subplotId
            ? (subplotColorMap.get(conn.subplotId) ?? typeColor)
            : typeColor;
        const markerEnd = isSelected ? 'url(#pb-arrow-selected)' : `url(#pb-arrow-${conn.type})`;
        const isDashed = conn.type === 'parallel';

        return (
          <g
            key={conn.id}
            data-testid="connection-group"
            aria-label={`${conn.type} ${t('sceneboard.canvas.connectionLabel')}`}
          >
            {/* Visible path (pointer-events:none so it doesn't block hit-test below) */}
            <path
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={isSelected || isHovered ? 3 : 2}
              strokeDasharray={isDashed ? '6,3' : undefined}
              opacity={isSelected || isHovered ? 1 : 0.75}
              markerEnd={markerEnd}
              pointerEvents="none"
            />
            {/* Invisible thick hit-test path (≥44px touch target) — pointer-events:stroke overrides parent none */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={44}
              tabIndex={0}
              role="button"
              aria-label={conn.label ?? `${conn.type} connection`}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredId(conn.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleSelect(conn.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleSelect(conn.id);
              }}
            />
            {/* Label (visible when selected or when conn has an explicit label) */}
            {(conn.label || isSelected) && (
              <text
                x={midX}
                y={midY}
                textAnchor="middle"
                fontSize={11}
                fill={strokeColor}
                pointerEvents="none"
                style={{ userSelect: 'none' }}
              >
                {conn.label ?? conn.type}
              </text>
            )}
          </g>
        );
      })}

      {/* Draw-mode live preview line */}
      {isDrawing && drawFromCenter && cursorCanvasPos && (
        <path
          d={`M ${drawFromCenter.x},${drawFromCenter.y} L ${cursorCanvasPos.x},${cursorCanvasPos.y}`}
          fill="none"
          stroke="var(--sc-text-muted,#9ca3af)"
          strokeWidth={2}
          strokeDasharray="8,4"
          markerEnd="url(#pb-arrow-preview)"
          pointerEvents="none"
        />
      )}
    </svg>
  );
};
