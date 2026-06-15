import type { FC, PointerEvent } from 'react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLongPress } from '../../hooks/useLongPress';
import type { Character, StorySection } from '../../types';
import { ConnectionLayer } from './ConnectionLayer';
import { ConnectionToolbar } from './ConnectionToolbar';
import { PlotMinimap } from './PlotMinimap';
import { snapToGrid } from './plotLayoutUtils';

// Canvas card dimensions (must match autoLayoutScenes constants)
const CARD_W = 200;
const CARD_H = 130;

interface CanvasCardProps {
  section: StorySection;
  x: number;
  y: number;
  zoom: number;
  t: (key: string, replacements?: Record<string, string>) => string;
  isDrawing: boolean;
  onPointerDown: (e: PointerEvent<HTMLDivElement>, sectionId: string) => void;
  onCardClick: (sectionId: string) => void;
  onCardLongPress: (sectionId: string) => void;
}

const CanvasCard: FC<CanvasCardProps> = React.memo(
  ({ section, x, y, t, isDrawing, onPointerDown, onCardClick, onCardLongPress }) => {
    const longPress = useLongPress(() => onCardLongPress(section.id), 550);
    // QNBS-v3: status colors use the design-system data-viz palette so they adapt to theme/sepia.
    const statusColors: Record<string, string> = {
      draft: 'var(--sc-text-muted)',
      outline: 'var(--sc-data-4)',
      'first-draft': 'var(--sc-data-2)',
      revised: 'var(--sc-data-6)',
      final: 'var(--sc-data-3)',
    };
    const statusColor = statusColors[section.status || 'draft'] || 'var(--sc-text-muted)';

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
        className="bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-sc-lg p-3 shadow-sc-sm hover:shadow-sc-md transition-[box-shadow] duration-sc-normal ease-sc-standard select-none"
        onPointerDown={(e) => {
          longPress.onPointerDown(e);
          onPointerDown(e, section.id);
        }}
        onPointerUp={longPress.onPointerUp}
        onPointerMove={longPress.onPointerMove}
        onPointerCancel={longPress.onPointerCancel}
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
            style={{ backgroundColor: section.color || 'var(--sc-data-2)' }}
          />
          {/* QNBS-v3: RTL beta — board wrapper is .rtl-keep-ltr for pointer geometry, but user
              text must read per its own script; dir="auto" restores RTL/BiDi for Arabic/Hebrew. */}
          <h4
            dir="auto"
            className="text-sm font-semibold text-[var(--sc-text-primary)] line-clamp-1"
          >
            {section.title}
          </h4>
        </div>
        {section.summary && (
          <p dir="auto" className="text-xs text-[var(--sc-text-muted)] line-clamp-2 mb-2">
            {section.summary}
          </p>
        )}
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
          <span className="text-xs text-[var(--sc-text-muted)] capitalize">
            {section.status || 'draft'}
          </span>
          <span className="ml-auto text-xs text-[var(--sc-text-muted)]">
            {section.wordCount || 0} W.
          </span>
        </div>
      </div>
    );
  },
);
CanvasCard.displayName = 'CanvasCard';

interface PlotCanvasProps {
  sections: StorySection[];
  characters: Character[];
  layout: Record<string, { x: number; y: number }>;
  t: (key: string, replacements?: Record<string, string>) => string;
  onEditSection: (id: string) => void;
  onSectionLongPress?: (id: string) => void;
}

export const PlotCanvas: FC<PlotCanvasProps> = ({
  sections,
  layout,
  t,
  onEditSection,
  onSectionLongPress,
}) => {
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
  // QNBS-v3: rAF ref to coalesce burst pointer events — cancel pending frame before scheduling next.
  const rafRef = useRef<number | null>(null);
  const reducedMotion =
    typeof document !== 'undefined' &&
    document.body.classList.contains('worldscript-reduced-motion');

  // Cancel any pending rAF on unmount to prevent dispatching into an unmounted tree.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

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
      // Always update pointer map synchronously — pinch needs fresh positions immediately.
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinchState.current && activePointers.current.size >= 2) {
        // QNBS-v3: pinch-to-zoom dispatches synchronously — rAF would introduce a perceptible lag.
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

      // QNBS-v3: rAF throttle — collapses burst pointer events on High-DPI into one Redux dispatch per frame.
      const clientX = e.clientX;
      const clientY = e.clientY;
      const captured = dragState.current;
      const rect = wrapperRef.current?.getBoundingClientRect() ?? null;

      const applyMove = () => {
        if (rect) {
          setCursorCanvasPos({
            x: (clientX - rect.left - panX) / zoom,
            y: (clientY - rect.top - panY) / zoom,
          });
        }
        const dx = clientX - captured.startX;
        const dy = clientY - captured.startY;
        if (captured.type === 'pan') {
          dispatch(
            plotBoardActions.setPan({
              panX: captured.origX + dx,
              panY: captured.origY + dy,
            }),
          );
        } else if (captured.type === 'card' && captured.sectionId) {
          const newX = snapToGrid(captured.origX + dx / zoom, snapGrid);
          const newY = snapToGrid(captured.origY + dy / zoom, snapGrid);
          dispatch(
            projectActions.updateSceneBoardLayout({
              [captured.sectionId]: { x: newX, y: newY },
            }),
          );
        }
      };

      if (reducedMotion) {
        applyMove();
        return;
      }

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyMove();
      });
    },
    [dispatch, snapGrid, zoom, panY, panX, reducedMotion],
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
      // QNBS-v3: RTL beta — keep the board LTR; pointer/pan math uses getBoundingClientRect and breaks if mirrored.
      className="rtl-keep-ltr relative w-full h-full overflow-hidden bg-[var(--sc-surface-base)] rounded-xl border border-[var(--sc-border-subtle)]"
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
            <circle cx="1" cy="1" r="1" fill="var(--sc-text-muted)" />
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
              onCardLongPress={onSectionLongPress ?? onEditSection}
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

      <PlotMinimap
        sections={sections}
        layout={layout}
        canvasW={canvasBounds.w}
        canvasH={canvasBounds.h}
        panX={panX}
        panY={panY}
        zoom={zoom}
        ariaLabel={t('sceneboard.minimap.ariaLabel')}
      />

      {/* Empty state */}
      {sections.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-[var(--sc-text-muted)]">{t('sceneboard.canvas.empty')}</p>
        </div>
      )}
    </div>
  );
};
