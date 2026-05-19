import type { StorySection } from '../types';

// ─── Tension Curve ────────────────────────────────────────────────────────────

// QNBS-v3: Map instead of Record so index access is type-safe (no | undefined).
const STATUS_TENSION = new Map<string, number>([
  ['outline', 3],
  ['draft', 2],
  ['first-draft', 5],
  ['revised', 7],
  ['final', 9],
]);

export interface TensionPoint {
  sectionId: string;
  sectionTitle: string;
  /** 0–10; auto-computed or user-overridden. */
  score: number;
  isOverridden: boolean;
}

/**
 * Computes a tension curve for all sections in manuscript order.
 * User overrides in `tensionOverrides` take precedence over auto-computed values.
 */
export function computeTensionCurve(
  sections: StorySection[],
  tensionOverrides: Record<string, number>,
): TensionPoint[] {
  return sections.map((section) => {
    const isOverridden = section.id in tensionOverrides;
    const score = isOverridden
      ? (tensionOverrides[section.id] ?? 0)
      : (STATUS_TENSION.get(section.status ?? 'draft') ?? 2);
    return {
      sectionId: section.id,
      sectionTitle: section.title,
      score,
      isOverridden,
    };
  });
}

// ─── Auto Layout ─────────────────────────────────────────────────────────────

/** Card dimensions for layout calculations (pixels). */
const CARD_W = 200;
const CARD_H = 130;
const COL_GAP = 40;
const ROW_GAP = 30;
const ACT_GAP = 80; // extra horizontal space between acts

/**
 * Generates a grid layout for scenes grouped by act.
 * Each act occupies its own column group, scenes stack vertically within the act.
 */
export function autoLayoutScenes(
  sections: StorySection[],
): Record<string, { x: number; y: number }> {
  const noAct: StorySection[] = [];
  const act1: StorySection[] = [];
  const act2: StorySection[] = [];
  const act3: StorySection[] = [];

  for (const s of sections) {
    if (s.act === 1) act1.push(s);
    else if (s.act === 2) act2.push(s);
    else if (s.act === 3) act3.push(s);
    else noAct.push(s);
  }

  const byAct: [StorySection[], StorySection[], StorySection[]] = [[...noAct, ...act1], act2, act3];

  const positions: Record<string, { x: number; y: number }> = {};
  let xOffset = 40;

  for (const actSections of byAct) {
    actSections.forEach((section, rowIndex) => {
      positions[section.id] = {
        x: xOffset,
        y: 40 + rowIndex * (CARD_H + ROW_GAP),
      };
    });
    if (actSections.length > 0) {
      xOffset += CARD_W + COL_GAP + ACT_GAP;
    }
  }

  return positions;
}

// ─── Beat Sheets ─────────────────────────────────────────────────────────────

export interface BeatMarker {
  label: string;
  /** Fractional position on the X-axis (0–1). */
  pct: number;
  color: string;
}

export type BeatSheetPreset = 'three-act' | 'save-the-cat' | 'heros-journey';

export const BEAT_SHEETS: Record<BeatSheetPreset, BeatMarker[]> = {
  'three-act': [
    { label: 'Act 1 End', pct: 0.25, color: '#6366f1' },
    { label: 'Midpoint', pct: 0.5, color: '#a855f7' },
    { label: 'Act 2 End', pct: 0.75, color: '#6366f1' },
  ],
  'save-the-cat': [
    { label: 'Opening Image', pct: 0.01, color: '#64748b' },
    { label: 'Theme Stated', pct: 0.05, color: '#64748b' },
    { label: 'Set-Up', pct: 0.1, color: '#64748b' },
    { label: 'Catalyst', pct: 0.12, color: '#6366f1' },
    { label: 'Debate', pct: 0.2, color: '#64748b' },
    { label: 'Break Into 2', pct: 0.25, color: '#6366f1' },
    { label: 'Fun & Games', pct: 0.4, color: '#64748b' },
    { label: 'Midpoint', pct: 0.5, color: '#a855f7' },
    { label: 'Bad Guys Close In', pct: 0.6, color: '#64748b' },
    { label: 'All Is Lost', pct: 0.75, color: '#ef4444' },
    { label: 'Dark Night of Soul', pct: 0.8, color: '#64748b' },
    { label: 'Break Into 3', pct: 0.83, color: '#6366f1' },
    { label: 'Finale', pct: 0.9, color: '#64748b' },
    { label: 'Final Image', pct: 0.99, color: '#64748b' },
  ],
  'heros-journey': [
    { label: 'Ordinary World', pct: 0.0, color: '#64748b' },
    { label: 'Call to Adventure', pct: 0.1, color: '#6366f1' },
    { label: 'Refusal of Call', pct: 0.18, color: '#64748b' },
    { label: 'Meeting the Mentor', pct: 0.25, color: '#64748b' },
    { label: 'Crossing Threshold', pct: 0.33, color: '#a855f7' },
    { label: 'Tests, Allies, Enemies', pct: 0.45, color: '#64748b' },
    { label: 'Innermost Cave', pct: 0.55, color: '#ef4444' },
    { label: 'Ordeal', pct: 0.62, color: '#ef4444' },
    { label: 'Reward', pct: 0.7, color: '#6366f1' },
    { label: 'Road Back', pct: 0.8, color: '#64748b' },
    { label: 'Resurrection', pct: 0.9, color: '#a855f7' },
    { label: 'Return with Elixir', pct: 1.0, color: '#6366f1' },
  ],
};

// ─── SVG Export ───────────────────────────────────────────────────────────────

/**
 * Serializes an SVG element to a downloadable string.
 * Caller obtains the SVG ref from the canvas component.
 */
export function exportBoardAsSvg(svg: SVGSVGElement): string {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${svgStr}`;
}
