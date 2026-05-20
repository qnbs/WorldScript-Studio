import type { FC, PointerEvent } from 'react';
import React, { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../../app/hooks';
import {
  plotBoardActions,
  selectDrawFromSectionId,
  selectIsDrawingConnection,
  selectPan,
  selectSnapToGrid,
  selectZoom,
} from '../../features/plotBoard/plotBoardSlice';
import { projectActions } from '../../features/project/projectSlice';
import type { Character, StorySection } from '../../types';
import { ConnectionLayer } from './ConnectionLayer';
import { ConnectionToolbar } from './ConnectionToolbar';

// Canvas card dimensions (must match autoLayoutScenes constants)
const CARD_W = 200;
const CARD_H = 130;

// Mini-map viewport size (px)
const MINI_W = 120;
const MINI_H = 75;

function snapToGrid(value: number, snap: boolean, gridSize = 8): number {
  if (!snap) return value;
  return Math.round(value / gridSize) * gridSize;
}

interface CanvasCardProps {
  section: StorySection;
  x: number;
  y: number;
  zoom: number;
  t: (key: string, replacements?: Record<string, string>) => string;
  isDrawing: boolean;
  onPointerDown: (e: PointerEvent<HTMLDivElement>, sectionId: string) => void;
  onCardClick: (sectionId: string) => void;
}

const CanvasCard: FC<CanvasCardProps> = React.memo(
  ({ section, x, y, t, isDrawing, onPointerDown, onCardClick }) => {
    const statusColors: Record<string, string> = {
      draft: '#6b7280',
      outline: '#f59e0b',
      'first-draft': '#3b82f6',
      revised: '#8b5cf6',
      final: '#10b981',
    };
    const statusColor = statusColors[section.status || 'draft'] || '#6b7280';

    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={t('sceneboard.editScene', { title: section.title })}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          width: CARD_W,
          minHeight: CARD_H,
          cursor: isDrawing ? 'crosshair' : 'grab',
        }}
        className="bg-[var(--background-secondary)] border border-[var(--border-primary)] rounded-sc-lg p-3 shadow-sc-sm hover:shadow-sc-md transition-[box-shadow] duration-sc-normal ease-sc-standard select-none"
        onPointerDown={(e) => onPointerDown(e, section.id)}
        onClick={() => {
          if (!isDrawing) onCardClick(section.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onCardClick(section.id);
        }}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: section.color || '#3b82f6' }}
          />
          <h4 className="text-sm font-semibold text-[var(--foreground-primary)] line-clamp-1">
            {section.title}
          </h4>
        </div>
        {section.summary && (
          <p className="text-xs text-[var(--foreground-muted)] line-clamp-2 mb-2">
            {section.summary}
          </p>
        )}
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
          <span className="text-xs text-[var(--foreground-muted)] capitalize">
            {section.status || 'draft'}
          </span>
          <span className="ml-auto text-xs text-[var(--foreground-muted)]">
            {section.wordCount || 0} W.
          </span>
        </div>
      </div>
    );
  },
);
CanvasCard.displayName = 'CanvasCard';

// Mini-map: fixed-position overview showing scene positions at scale
const MiniMap: FC<{
  sections: StorySection[];
  layout: Record<string, { x: number; y: number }>;
  canvasW: number;
  canvasH: number;
  panX: number;
  panY: number;
  zoom: number;
}> = ({ sections, layout, canvasW, canvasH, panX, panY, zoom }) => {
  const scaleX = MINI_W / Math.max(canvasW, 1);
  const scaleY = MINI_H / Math.max(canvasH, 1);

  // Viewport rect in canvas-space → mini-map-space
  const vpW = (window.innerWidth / zoom) * scaleX;
  const vpH = (window.innerHeight / zoom) * scaleY;
  const vpX = (-panX / zoom) * scaleX;
  const vpY = (-panY / zoom) * scaleY;

  return (
    <svg
      width={MINI_W}
      height={MINI_H}
      role="img"
      aria-label="Canvas mini-map"
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: 'var(--background-secondary)',
        border: '1px solid var(--border-primary)',
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
      {/* Viewport indicator */}
      <rect
        x={vpX}
        y={vpY}
        width={Math.max(vpW, 4)}
        height={Math.max(vpH, 4)}
        fill="none"
        stroke="var(--sc-accent-primary, #6366f1)"
        strokeWidth={1}
        opacity={0.8}
      />
    </svg>
  );
};

interface PlotCanvasProps {
  sections: StorySection[];
  characters: Character[];
  layout: Record<string, { x: number; y: number }>;
  t: (key: string, replacements?: Record<string, string>) => string;
  onEditSection: (id: string) => void;
}

export const PlotCanvas: FC<PlotCanvasProps> = ({ sections, layout, t, onEditSection }) => {
  const dispatch = useAppDispatch();
  const zoom = useAppSelectorShallow(selectZoom);
  const { panX, panY } = useAppSelectorShallow(selectPan);
  const snapGrid = useAppSelectorShallow(selectSnapToGrid);
  const isDrawing = useAppSelectorShallow(selectIsDrawingConnection);
  const drawFromSectionId = useAppSelectorShallow(selectDrawFromSectionId);

  const canvasRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Cursor position in canvas-space for ConnectionLayer draw preview
  const [cursorCanvasPos, setCursorCanvasPos] = useState<{ x: number; y: number } | null>(null);

  // Track which section is being dragged
  const dragState = useRef<{
    type: 'card' | 'pan';
    sectionId?: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    pointerId: number;
  } | null>(null);

  // Two-pointer pinch state
  const pinchState = useRef<{
    p1Id: number;
    p2Id: number;
    p1X: number;
    p1Y: number;
    p2X: number;
    p2Y: number;
    initZoom: number;
    initPanX: number;
    initPanY: number;
  } | null>(null);

  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Canvas virtual dimensions for the mini-map
  const [canvasBounds] = useState({ w: 2400, h: 1600 });

  // ── Wheel zoom ──────────────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      dispatch(plotBoardActions.setZoom(zoom * delta));
    },
    [dispatch, zoom],
  );

  // ── Pointer events (unified touch + mouse) ──────────────────────────────────
  const handleCanvasPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      // Background pan (only when clicking directly on the canvas backdrop)
      if (e.target !== wrapperRef.current && e.target !== canvasRef.current) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size === 2) {
        // Start pinch-to-zoom
        const entries = [...activePointers.current.entries()];
        // exactOptionalPropertyTypes: entries are always present here (size === 2)
        const p1 = entries[0]!;
        const p2 = entries[1]!;
        pinchState.current = {
          p1Id: p1[0],
          p2Id: p2[0],
          p1X: p1[1].x,
          p1Y: p1[1].y,
          p2X: p2[1].x,
          p2Y: p2[1].y,
          initZoom: zoom,
          initPanX: panX,
          initPanY: panY,
        };
        dragState.current = null;
      } else {
        pinchState.current = null;
        dragState.current = {
          type: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          origX: panX,
          origY: panY,
          pointerId: e.pointerId,
        };
      }
    },
    [panX, panY, zoom],
  );

  const handleCardPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>, sectionId: string) => {
      if (isDrawing) {
        // In draw mode, clicking a card finishes the connection.
        // QNBS-v3: Connection created in projectSlice (undo-able); draw UI state cleared separately.
        e.stopPropagation();
        if (drawFromSectionId) {
          dispatch(
            projectActions.finishPlotDrawConnection({
              fromSectionId: drawFromSectionId,
              toSectionId: sectionId,
              type: 'cause-effect',
              newId: `conn-${Date.now()}`,
            }),
          );
        }
        dispatch(plotBoardActions.finishDrawConnection());
        return;
      }
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pos = layout[sectionId] || { x: 0, y: 0 };
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragState.current = {
        type: 'card',
        sectionId,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
        pointerId: e.pointerId,
      };
    },
    [dispatch, drawFromSectionId, isDrawing, layout],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Track cursor in canvas-space for ConnectionLayer draw preview
      if (wrapperRef.current) {
        const rect = wrapperRef.current.getBoundingClientRect();
        setCursorCanvasPos({
          x: (e.clientX - rect.left - panX) / zoom,
          y: (e.clientY - rect.top - panY) / zoom,
        });
      }

      if (pinchState.current && activePointers.current.size >= 2) {
        // Pinch-to-zoom
        const entries = [...activePointers.current.entries()];
        const p1e = entries[0]!;
        const p2e = entries[1]!;
        const currDist = Math.hypot(p1e[1].x - p2e[1].x, p1e[1].y - p2e[1].y);
        const origDist = Math.hypot(
          pinchState.current.p1X - pinchState.current.p2X,
          pinchState.current.p1Y - pinchState.current.p2Y,
        );
        if (origDist > 0) {
          const newZoom = Math.min(
            4,
            Math.max(0.25, pinchState.current.initZoom * (currDist / origDist)),
          );
          dispatch(plotBoardActions.setZoom(newZoom));
        }
        return;
      }

      if (!dragState.current || dragState.current.pointerId !== e.pointerId) return;

      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;

      if (dragState.current.type === 'pan') {
        dispatch(
          plotBoardActions.setPan({
            panX: dragState.current.origX + dx,
            panY: dragState.current.origY + dy,
          }),
        );
      } else if (dragState.current.type === 'card' && dragState.current.sectionId) {
        // Move card — scale delta by zoom so canvas-space matches screen-space
        const newX = snapToGrid(dragState.current.origX + dx / zoom, snapGrid);
        const newY = snapToGrid(dragState.current.origY + dy / zoom, snapGrid);
        dispatch(
          projectActions.updateSceneBoardLayout({
            [dragState.current.sectionId]: { x: newX, y: newY },
          }),
        );
      }
    },
    [dispatch, snapGrid, zoom, panY, panX],
  );

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchState.current = null;
    }
    if (dragState.current?.pointerId === e.pointerId) {
      dragState.current = null;
    }
  }, []);

  return (
    // QNBS-v3: overflow hidden + touch-action:none prevents browser scroll from hijacking canvas pan.
    <div
      ref={wrapperRef}
      className="relative w-full h-full overflow-hidden bg-[var(--background-primary)] rounded-xl border border-[var(--border-primary)]"
      style={{ touchAction: 'none', cursor: isDrawing ? 'crosshair' : 'default' }}
      role="application"
      aria-label={t('sceneboard.canvas.ariaLabel')}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Dot-grid background */}
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 0.25,
        }}
      >
        <defs>
          <pattern
            id="dot-grid"
            x={panX % 20}
            y={panY % 20}
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="var(--foreground-muted)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dot-grid)" />
      </svg>

      {/* Transformed canvas layer */}
      <div
        ref={canvasRef}
        style={{
          position: 'absolute',
          transformOrigin: '0 0',
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          width: canvasBounds.w,
          height: canvasBounds.h,
        }}
      >
        {sections.map((section) => {
          const pos = layout[section.id] || { x: 40, y: 40 };
          return (
            <CanvasCard
              key={section.id}
              section={section}
              x={pos.x}
              y={pos.y}
              zoom={zoom}
              t={t}
              isDrawing={isDrawing}
              onPointerDown={handleCardPointerDown}
              onCardClick={onEditSection}
            />
          );
        })}

        {/* SVG connection overlay — inside transform so coordinates match card positions */}
        <ConnectionLayer
          layout={layout}
          canvasW={canvasBounds.w}
          canvasH={canvasBounds.h}
          cursorCanvasPos={cursorCanvasPos}
          t={t}
        />
      </div>

      {/* Connection toolbar — outside transform so it stays in screen-space */}
      <ConnectionToolbar t={t} />

      {/* Mini-map */}
      <MiniMap
        sections={sections}
        layout={layout}
        canvasW={canvasBounds.w}
        canvasH={canvasBounds.h}
        panX={panX}
        panY={panY}
        zoom={zoom}
      />

      {/* Empty state */}
      {sections.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-[var(--foreground-muted)]">{t('sceneboard.canvas.empty')}</p>
        </div>
      )}
    </div>
  );
};
