/**
 * Regelbasierte Hinweise zur Szenen-Zeitachse (Manuskript-Reihenfolge).
 * QNBS-v3: Logik vor KI — klare Warnungen für Plot-Zeit ohne Cloud.
 */

import type { StorySection } from '../types';
import { querySceneOverlapsWithTitles } from './duckdb/duckdbAnalytics';

export type SceneTimelineSeverity = 'info' | 'warn';

export interface SceneTimelineHint {
  id: string;
  severity: SceneTimelineSeverity;
  /** i18n-Key unter sceneboard.timeline.* */
  messageKey: string;
  params?: Record<string, string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function parseSceneStartMs(sceneStart: string | undefined): number | null {
  if (!sceneStart?.trim()) return null;
  const s = sceneStart.trim();
  if (!ISO_DATE.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Grobe Dauer in ms: ISO-8601 Duration (PT…), oder „Nn unit“ mit unit ∈ minutes|hours|days|weeks. */
export function parseSceneDurationMs(duration: string | undefined): number | null {
  if (!duration?.trim()) return null;
  const d = duration.trim();
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/i.exec(d);
  if (iso) {
    const days = Number(iso[1] ?? 0);
    const hours = Number(iso[2] ?? 0);
    const minutes = Number(iso[3] ?? 0);
    const seconds = Number(iso[4] ?? 0);
    if (days + hours + minutes + seconds <= 0) return null;
    return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  }
  const loose = /^(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days|week|weeks)s?$/i.exec(d);
  if (loose) {
    const n = Number(loose[1]);
    const unitRaw = loose[2];
    if (!unitRaw) return null;
    const u = unitRaw.toLowerCase();
    const mult = u.startsWith('minute')
      ? 60_000
      : u.startsWith('hour')
        ? 3_600_000
        : u.startsWith('day')
          ? 86_400_000
          : u.startsWith('week')
            ? 604_800_000
            : 0;
    return n * mult;
  }
  return null;
}

const MAX_HINTS = 32;

/**
 * Async DuckDB-backed version of evaluateSceneTimeline — P3.
 * Queries v_scene_overlap (self-JOIN on scene_start) instead of iterating in JS.
 * Falls back gracefully when DuckDB returns no rows (e.g. scene_start not yet populated).
 */
export async function evaluateSceneTimelineDuckDb(
  projectId: string,
  signal?: AbortSignal,
): Promise<SceneTimelineHint[]> {
  const rows = await querySceneOverlapsWithTitles(projectId, MAX_HINTS, signal);
  return rows.map((row) => ({
    id: `overlap-${row.section_a}-${row.section_b}`,
    severity: 'warn' as SceneTimelineSeverity,
    messageKey: 'sceneboard.timeline.overlap',
    params: { prev: row.title_a, next: row.title_b },
  }));
}

export function evaluateSceneTimeline(sections: StorySection[]): SceneTimelineHint[] {
  const hints: SceneTimelineHint[] = [];
  const ordered = [...sections];

  let prevEnd: { ms: number; title: string; id: string } | null = null;

  for (const sec of ordered) {
    const startMs = parseSceneStartMs(sec.sceneStart);
    const durMs = parseSceneDurationMs(sec.sceneDuration);

    const pushHint = (h: SceneTimelineHint) => {
      if (hints.length < MAX_HINTS) hints.push(h);
    };

    if (
      (sec.sceneDuration?.trim() && durMs === null) ||
      (sec.sceneStart?.trim() && startMs === null)
    ) {
      pushHint({
        id: `parse-${sec.id}`,
        severity: 'info',
        messageKey: 'sceneboard.timeline.unparsedFields',
        params: { title: sec.title },
      });
    }

    if (startMs !== null && durMs !== null && durMs <= 0) {
      pushHint({
        id: `dur-${sec.id}`,
        severity: 'warn',
        messageKey: 'sceneboard.timeline.nonPositiveDuration',
        params: { title: sec.title },
      });
    }

    if (startMs !== null && prevEnd !== null && startMs + 1 < prevEnd.ms) {
      pushHint({
        id: `overlap-${prevEnd.id}-${sec.id}`,
        severity: 'warn',
        messageKey: 'sceneboard.timeline.overlap',
        params: { prev: prevEnd.title, next: sec.title },
      });
    }

    if (startMs !== null && durMs !== null) {
      prevEnd = { ms: startMs + durMs, title: sec.title, id: sec.id };
    } else if (startMs !== null) {
      prevEnd = { ms: startMs, title: sec.title, id: sec.id };
    }
  }

  return hints;
}
