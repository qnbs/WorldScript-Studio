import type { FC } from 'react';
import { useMemo } from 'react';
import {
  evaluateSceneTimeline,
  parseSceneDurationMs,
  parseSceneStartMs,
} from '../services/sceneTimelineRules';
import type { StorySection } from '../types';

interface SceneTimelinePanelProps {
  sections: (StorySection & { wordCount?: number })[];
  t: (key: string, replacements?: Record<string, string>) => string;
}

const MAX_RULE_ROWS = 18;
const MAX_CHART_ROWS = 32;

/** QNBS-v3: Analytische Timeline — Regeln + Gantt-light ohne schwere Chart-Library. */
export const SceneTimelinePanel: FC<SceneTimelinePanelProps> = ({ sections, t }) => {
  const hints = useMemo(() => evaluateSceneTimeline(sections), [sections]);
  const hintsShown = useMemo(() => hints.slice(0, MAX_RULE_ROWS), [hints]);
  const rulesTruncated = hints.length > MAX_RULE_ROWS;

  const wordShares = useMemo(() => {
    const words = sections.map(
      (s) => s.wordCount ?? s.content?.split(/\s+/).filter(Boolean).length ?? 0,
    );
    const sum = words.reduce((a, b) => a + b, 0) || 1;
    return sections.slice(0, MAX_CHART_ROWS).map((section, i) => {
      const w = words[i] ?? 0;
      return {
        section,
        pct: Math.max(1.5, (w / sum) * 100),
        words: w,
      };
    });
  }, [sections]);

  const timedLanes = useMemo(() => {
    const intervals = sections
      .map((s) => {
        const start = parseSceneStartMs(s.sceneStart);
        const dur = parseSceneDurationMs(s.sceneDuration);
        if (start === null) return null;
        const end = dur !== null ? start + dur : start + 3_600_000;
        return { section: s, start, end };
      })
      .filter(Boolean) as { section: StorySection; start: number; end: number }[];

    if (intervals.length === 0) return null;
    const minT = Math.min(...intervals.map((x) => x.start));
    const maxT = Math.max(...intervals.map((x) => x.end));
    const span = Math.max(1, maxT - minT);
    // QNBS-v3: Skala aus allen Intervallen; render-seitig nur ersten N Balken (DOM-Limit).
    return intervals.map(({ section, start, end }) => ({
      section,
      leftPct: ((start - minT) / span) * 100,
      widthPct: Math.max(3, ((end - start) / span) * 100),
    }));
  }, [sections]);

  return (
    <div className="flex flex-col gap-6 pb-8">
      <section
        aria-label={t('sceneboard.timeline.regionRules')}
        className="rounded-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/40 p-4"
      >
        <h2 className="text-sm font-semibold text-[var(--sc-text-primary)] mb-2">
          {t('sceneboard.timeline.rulesTitle')}
        </h2>
        {hints.length === 0 ? (
          <p className="text-xs text-[var(--sc-text-muted)]">{t('sceneboard.timeline.noHints')}</p>
        ) : (
          <>
            <ul className="space-y-2 text-xs max-h-52 overflow-y-auto pr-1">
              {hintsShown.map((h) => (
                <li
                  key={h.id}
                  className={
                    h.severity === 'warn'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[var(--sc-text-secondary)]'
                  }
                >
                  {t(h.messageKey, h.params)}
                </li>
              ))}
            </ul>
            {rulesTruncated ? (
              <p className="text-xs text-[var(--sc-text-muted)] mt-2">
                {t('sceneboard.timeline.rulesTruncated')}
              </p>
            ) : null}
          </>
        )}
      </section>

      <section
        aria-label={t('sceneboard.timeline.regionChart')}
        className="rounded-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/40 p-4"
      >
        <h2 className="text-sm font-semibold text-[var(--sc-text-primary)] mb-3">
          {timedLanes ? t('sceneboard.timeline.chartTimed') : t('sceneboard.timeline.chartWords')}
        </h2>
        <div className="space-y-2">
          {timedLanes
            ? timedLanes.slice(0, MAX_CHART_ROWS).map(({ section, leftPct, widthPct }) => (
                <div key={section.id} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-xs text-[var(--sc-text-secondary)]">
                    {section.title}
                  </span>
                  <div className="relative flex-1 h-6 rounded-md bg-[var(--sc-surface-overlay)] overflow-hidden">
                    <div
                      className="absolute top-1 bottom-1 rounded bg-indigo-500/55 border border-indigo-400/40"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      title={section.sceneStart ?? ''}
                    />
                  </div>
                </div>
              ))
            : wordShares.map(({ section, pct, words }) => (
                <div key={section.id} className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-xs text-[var(--sc-text-secondary)]">
                    {section.title}
                  </span>
                  <div className="flex-1 h-6 rounded-md bg-[var(--sc-surface-overlay)] overflow-hidden flex">
                    <div
                      className="h-full bg-violet-500/45 border-r border-violet-400/30"
                      style={{ width: `${pct}%` }}
                      title={`${words} ${t('sceneboard.words')}`}
                    />
                  </div>
                </div>
              ))}
        </div>
        <p className="text-xs text-[var(--sc-text-muted)] mt-3">{t('sceneboard.timeline.hint')}</p>
      </section>
    </div>
  );
};
