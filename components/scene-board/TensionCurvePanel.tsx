// QNBS-v3: Pure SVG tension chart — no external dep, consistent with CharacterGraphView pattern.
//          User drag-overrides dispatch to plotBoardSlice; auto-computed line stays dashed/grey.
import type { FC, PointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../../app/hooks';
import { selectPlotTensionOverrides } from '../../features/project/projectSelectors';
import { projectActions } from '../../features/project/projectSlice';
import { computeTensionCurve } from '../../services/plotBoardService';
import type { StorySection } from '../../types';

// ── Beat sheet presets ────────────────────────────────────────────────────────

interface Beat {
  label: string;
  pct: number;
  color: string;
}

const BEAT_SHEETS: Record<string, Beat[]> = {
  'three-act': [
    { label: 'Act 1 End', pct: 0.25, color: '#6366f1' },
    { label: 'Midpoint', pct: 0.5, color: '#a855f7' },
    { label: 'Act 2 End', pct: 0.75, color: '#6366f1' },
  ],
  'save-the-cat': [
    { label: 'Opening Image', pct: 0.01, color: '#8b5cf6' },
    { label: 'Theme Stated', pct: 0.05, color: '#8b5cf6' },
    { label: 'Set-Up', pct: 0.1, color: '#8b5cf6' },
    { label: 'Catalyst', pct: 0.12, color: '#ec4899' },
    { label: 'Debate', pct: 0.2, color: '#8b5cf6' },
    { label: 'Break into 2', pct: 0.25, color: '#6366f1' },
    { label: 'B Story', pct: 0.3, color: '#8b5cf6' },
    { label: 'Fun & Games', pct: 0.4, color: '#8b5cf6' },
    { label: 'Midpoint', pct: 0.5, color: '#a855f7' },
    { label: 'Bad Guys Close In', pct: 0.6, color: '#ef4444' },
    { label: 'All Is Lost', pct: 0.75, color: '#ef4444' },
    { label: 'Dark Night of Soul', pct: 0.8, color: '#ef4444' },
    { label: 'Break into 3', pct: 0.85, color: '#6366f1' },
    { label: 'Finale', pct: 0.9, color: '#10b981' },
    { label: 'Final Image', pct: 0.99, color: '#10b981' },
  ],
  "hero's-journey": [
    { label: 'Ordinary World', pct: 0.04, color: '#6366f1' },
    { label: 'Call to Adventure', pct: 0.12, color: '#f59e0b' },
    { label: 'Refusal', pct: 0.18, color: '#ef4444' },
    { label: 'Mentor', pct: 0.25, color: '#10b981' },
    { label: 'Crossing Threshold', pct: 0.33, color: '#6366f1' },
    { label: 'Tests & Allies', pct: 0.42, color: '#8b5cf6' },
    { label: 'Approach', pct: 0.5, color: '#a855f7' },
    { label: 'Ordeal', pct: 0.62, color: '#ef4444' },
    { label: 'Reward', pct: 0.7, color: '#10b981' },
    { label: 'Road Back', pct: 0.8, color: '#6366f1' },
    { label: 'Resurrection', pct: 0.9, color: '#a855f7' },
    { label: 'Return', pct: 0.97, color: '#10b981' },
  ],
};

type BeatSheetKey = keyof typeof BEAT_SHEETS | 'none';

// ── SVG chart dimensions ──────────────────────────────────────────────────────

const SVG_W = 800;
const SVG_H = 200;
const PADDING_L = 30;
const PADDING_R = 20;
const PADDING_T = 20;
const PADDING_B = 30;

const CHART_W = SVG_W - PADDING_L - PADDING_R;
const CHART_H = SVG_H - PADDING_T - PADDING_B;

function xForIndex(i: number, count: number): number {
  if (count <= 1) return PADDING_L + CHART_W / 2;
  return PADDING_L + (i / (count - 1)) * CHART_W;
}

function yForScore(score: number): number {
  // score 0 → bottom, 10 → top
  return PADDING_T + CHART_H - (score / 10) * CHART_H;
}

function pointsToPolyline(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

// ── Draggable tension point ────────────────────────────────────────────────────

interface TensionDotProps {
  cx: number;
  cy: number;
  sectionId: string;
  score: number;
  isOverridden: boolean;
  onDragScore: (sectionId: string, score: number) => void;
}

const TensionDot: FC<TensionDotProps> = ({
  cx,
  cy,
  sectionId,
  score,
  isOverridden,
  onDragScore,
}) => {
  const dragging = useRef(false);
  const svgRef = useRef<SVGCircleElement>(null);

  const handlePointerDown = useCallback((e: PointerEvent<SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    // SVGCircleElement.setPointerCapture may be absent in some environments (e.g. jsdom)
    try {
      (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    } catch {
      // no-op
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent<SVGCircleElement>) => {
      if (!dragging.current) return;
      const svgEl = svgRef.current?.ownerSVGElement;
      if (!svgEl) return;
      const rect = svgEl.getBoundingClientRect();
      const relY = e.clientY - rect.top;
      const newScore = Math.min(10, Math.max(0, ((PADDING_T + CHART_H - relY) / CHART_H) * 10));
      onDragScore(sectionId, Math.round(newScore * 10) / 10);
    },
    [onDragScore, sectionId],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <circle
      ref={svgRef}
      cx={cx}
      cy={cy}
      r={5}
      fill={isOverridden ? 'var(--sc-accent-primary,#6366f1)' : 'var(--sc-text-muted,#9ca3af)'}
      stroke="var(--sc-surface-raised)"
      strokeWidth={2}
      style={{ cursor: 'ns-resize', touchAction: 'none' }}
      role="slider"
      aria-label={`Tension: ${score.toFixed(1)}`}
      aria-valuenow={score}
      aria-valuemin={0}
      aria-valuemax={10}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
};

// ── Main component ────────────────────────────────────────────────────────────

interface TensionCurvePanelProps {
  sections: StorySection[];
  t: (key: string) => string;
}

export const TensionCurvePanel: FC<TensionCurvePanelProps> = ({ sections, t }) => {
  const dispatch = useAppDispatch();
  const tensionOverrides = useAppSelectorShallow(selectPlotTensionOverrides);
  const [collapsed, setCollapsed] = useState(true);
  const [activeBeatSheet, setActiveBeatSheet] = useState<BeatSheetKey>('three-act');
  const [showBeats, setShowBeats] = useState(false);

  const points = computeTensionCurve(sections, tensionOverrides);

  const handleDragScore = useCallback(
    (sectionId: string, score: number) => {
      dispatch(projectActions.setPlotTensionOverride({ sectionId, score }));
    },
    [dispatch],
  );

  const handleClearOverrides = useCallback(() => {
    dispatch(projectActions.clearAllPlotTensionOverrides());
  }, [dispatch]);

  // Compute polyline coordinates
  const autoPoints = points.map((p, i) => ({
    x: xForIndex(i, points.length),
    y: yForScore(p.score),
  }));
  const overriddenPoints = points.map((p, i) => ({
    x: xForIndex(i, points.length),
    y: yForScore(p.score),
    isOverridden: p.isOverridden,
  }));

  // Beat sheet markers for active preset
  const beats = activeBeatSheet !== 'none' ? (BEAT_SHEETS[activeBeatSheet] ?? []) : [];

  return (
    <div className="flex-shrink-0 border-t border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]">
      {/* Collapse toggle bar */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] transition-colors"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="tension-curve-panel"
      >
        <span>{t('sceneboard.tension.title')}</span>
        <span aria-hidden="true">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <div id="tension-curve-panel" className="px-3 pb-3 space-y-2">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Beat sheet selector */}
            <label className="flex items-center gap-1 text-xs text-[var(--sc-text-muted)]">
              <input
                type="checkbox"
                checked={showBeats}
                onChange={(e) => setShowBeats(e.target.checked)}
                className="accent-[var(--sc-accent-primary,#6366f1)]"
              />
              {t('sceneboard.tension.showBeatSheet')}
            </label>
            {showBeats && (
              <select
                value={activeBeatSheet}
                onChange={(e) => setActiveBeatSheet(e.target.value as BeatSheetKey)}
                className="text-xs px-1 py-0.5 rounded bg-[var(--sc-surface-base)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] outline-none"
                aria-label={t('sceneboard.tension.beatSheetSelect')}
              >
                <option value="none">{t('sceneboard.tension.beatSheetNone')}</option>
                <option value="three-act">{t('sceneboard.tension.beatSheetThreeAct')}</option>
                <option value="save-the-cat">{t('sceneboard.tension.beatSheetSaveCat')}</option>
                <option value="hero's-journey">{t('sceneboard.tension.beatSheetHero')}</option>
              </select>
            )}
            <button
              type="button"
              onClick={handleClearOverrides}
              className="ml-auto text-xs text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] px-2 py-0.5 rounded hover:bg-[var(--sc-surface-overlay)]"
              aria-label={t('sceneboard.tension.clearOverrides')}
            >
              {t('sceneboard.tension.clearOverrides')}
            </button>
          </div>

          {sections.length === 0 ? (
            <p className="text-xs text-[var(--sc-text-muted)] text-center py-4">
              {t('sceneboard.tension.noScenes')}
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              width="100%"
              height={SVG_H}
              role="img"
              aria-label={t('sceneboard.tension.chartAriaLabel')}
              style={{ display: 'block' }}
            >
              {/* Y-axis labels */}
              {[0, 5, 10].map((v) => (
                <text
                  key={v}
                  x={PADDING_L - 4}
                  y={yForScore(v) + 4}
                  textAnchor="end"
                  fontSize={9}
                  fill="var(--sc-text-muted,#9ca3af)"
                >
                  {v}
                </text>
              ))}
              {/* Y-axis grid lines */}
              {[0, 5, 10].map((v) => (
                <line
                  key={`grid-${v}`}
                  x1={PADDING_L}
                  y1={yForScore(v)}
                  x2={PADDING_L + CHART_W}
                  y2={yForScore(v)}
                  stroke="var(--sc-border-subtle)"
                  strokeWidth={0.5}
                />
              ))}

              {/* Beat sheet overlay */}
              {showBeats &&
                beats.map((beat) => {
                  const bx = PADDING_L + beat.pct * CHART_W;
                  return (
                    <g key={beat.label}>
                      <line
                        x1={bx}
                        y1={PADDING_T}
                        x2={bx}
                        y2={PADDING_T + CHART_H}
                        stroke={beat.color}
                        strokeWidth={1}
                        strokeDasharray="3,2"
                        opacity={0.6}
                      />
                      <text
                        x={bx + 2}
                        y={PADDING_T + 8}
                        fontSize={7}
                        fill={beat.color}
                        opacity={0.8}
                      >
                        {beat.label}
                      </text>
                    </g>
                  );
                })}

              {/* Auto-computed line (dashed, muted) */}
              <polyline
                points={pointsToPolyline(autoPoints)}
                fill="none"
                stroke="var(--sc-text-muted,#9ca3af)"
                strokeWidth={1.5}
                strokeDasharray="4,3"
                opacity={0.5}
              />

              {/* Override line (solid, accent) */}
              <polyline
                points={pointsToPolyline(overriddenPoints)}
                fill="none"
                stroke="var(--sc-accent-primary,#6366f1)"
                strokeWidth={2}
                opacity={0.9}
              />

              {/* Draggable dots + scene labels */}
              {points.map((p, i) => {
                const cx = xForIndex(i, points.length);
                const cy = yForScore(p.score);
                const label =
                  p.sectionTitle.length > 12 ? `${p.sectionTitle.slice(0, 11)}…` : p.sectionTitle;
                return (
                  <g key={p.sectionId}>
                    <TensionDot
                      cx={cx}
                      cy={cy}
                      sectionId={p.sectionId}
                      score={p.score}
                      isOverridden={p.isOverridden}
                      onDragScore={handleDragScore}
                    />
                    {/* Score tooltip above dot */}
                    <text
                      x={cx}
                      y={cy - 8}
                      textAnchor="middle"
                      fontSize={8}
                      fill="var(--sc-text-muted,#9ca3af)"
                      pointerEvents="none"
                    >
                      {p.score.toFixed(0)}
                    </text>
                    {/* Scene label below x-axis */}
                    <text
                      x={cx}
                      y={PADDING_T + CHART_H + 18}
                      textAnchor="middle"
                      fontSize={8}
                      fill="var(--sc-text-muted,#9ca3af)"
                      pointerEvents="none"
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      )}
    </div>
  );
};
