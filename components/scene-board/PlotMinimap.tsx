import type { FC } from 'react';
import type { StorySection } from '../../types';

// QNBS-v3: Exported defaults allow callers to override at the usage site; constants no longer hard-coded inside props.
export const MINIMAP_W = 120;
export const MINIMAP_H = 75;
const CARD_W = 200;
const CARD_H = 130;

export interface PlotMinimapProps {
  sections: StorySection[];
  layout: Record<string, { x: number; y: number }>;
  canvasW: number;
  canvasH: number;
  panX: number;
  panY: number;
  zoom: number;
  ariaLabel?: string;
  /** Override minimap width in px (default: MINIMAP_W = 120). */
  width?: number;
  /** Override minimap height in px (default: MINIMAP_H = 75). */
  height?: number;
}

/** Fixed-position canvas overview (scene positions + viewport indicator). */
export const PlotMinimap: FC<PlotMinimapProps> = ({
  sections,
  layout,
  canvasW,
  canvasH,
  panX,
  panY,
  zoom,
  ariaLabel = 'Canvas mini-map',
  width = MINIMAP_W,
  height = MINIMAP_H,
}) => {
  const scaleX = width / Math.max(canvasW, 1);
  const scaleY = height / Math.max(canvasH, 1);
  const vpW = (window.innerWidth / zoom) * scaleX;
  const vpH = (window.innerHeight / zoom) * scaleY;
  const vpX = (-panX / zoom) * scaleX;
  const vpY = (-panY / zoom) * scaleY;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      className="plot-minimap"
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: 'var(--sc-surface-raised)',
        border: '1px solid var(--sc-border-subtle)',
        borderRadius: 6,
        opacity: 0.85,
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      {sections.map((s) => {
        const pos = layout[s.id];
        if (!pos) return null;
        return (
          <rect
            key={s.id}
            x={pos.x * scaleX}
            y={pos.y * scaleY}
            width={CARD_W * scaleX}
            height={CARD_H * scaleY}
            rx={2}
            fill={s.color || '#3b82f6'}
            opacity={0.7}
          />
        );
      })}
      <rect
        x={vpX}
        y={vpY}
        width={Math.max(vpW, 4)}
        height={Math.max(vpH, 4)}
        fill="none"
        stroke="var(--sc-ring-focus, #6366f1)"
        strokeWidth={1}
        opacity={0.8}
      />
    </svg>
  );
};
