import type { FC } from 'react';
import { useDashboardContext } from '../../contexts/DashboardContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { BookOpenIcon } from './dashboardIcons';

// QNBS-v3: Scene status taxonomy mirrors StorySection['status'] + an "untracked" bucket for
// scenes that never had a status set. Order = narrative maturity (outline → final).
const STATUS_META: { key: string; labelKey: string; color: string }[] = [
  { key: 'outline', labelKey: 'dashboard.composition.status.outline', color: 'bg-slate-400' },
  { key: 'draft', labelKey: 'dashboard.composition.status.draft', color: 'bg-amber-500' },
  {
    key: 'first-draft',
    labelKey: 'dashboard.composition.status.firstDraft',
    color: 'bg-blue-500',
  },
  { key: 'revised', labelKey: 'dashboard.composition.status.revised', color: 'bg-violet-500' },
  { key: 'final', labelKey: 'dashboard.composition.status.final', color: 'bg-emerald-500' },
  {
    key: 'untracked',
    labelKey: 'dashboard.composition.status.untracked',
    color: 'bg-[var(--sc-surface-overlay)]',
  },
];

const Metric: FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="min-w-0 rounded-2xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]/40 p-4 text-center backdrop-blur-sm">
    <p className="text-2xl font-black tabular-nums text-[var(--sc-text-primary)]">{value}</p>
    <p className="mt-1 break-words text-xs font-medium text-[var(--sc-text-muted)]">{label}</p>
  </div>
);

export const ManuscriptCompositionCard: FC = () => {
  const { t, statusCounts, sceneCount, readingTimeMinutes, avgWordsPerScene } =
    useDashboardContext();

  const buckets = STATUS_META.map((meta) => ({
    ...meta,
    count: statusCounts[meta.key] ?? 0,
  })).filter((b) => b.count > 0);

  return (
    <Card
      className="animate-in h-full border-[var(--sc-border-subtle)]"
      style={{ '--index': 4 } as React.CSSProperties}
    >
      <CardHeader className="flex items-center gap-2 border-b border-[var(--sc-border-subtle)] pb-4">
        <BookOpenIcon className="w-4 h-4 text-[var(--sc-text-muted)]" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.composition.title')}
        </h2>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        {sceneCount === 0 ? (
          <p className="text-sm text-[var(--sc-text-muted)]">{t('dashboard.composition.empty')}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Metric value={String(sceneCount)} label={t('dashboard.composition.scenes')} />
              <Metric
                value={avgWordsPerScene.toLocaleString()}
                label={t('dashboard.composition.avgPerScene')}
              />
              <Metric
                value={t('dashboard.composition.readingTimeValue', {
                  count: String(readingTimeMinutes),
                })}
                label={t('dashboard.composition.readingTime')}
              />
            </div>

            <div>
              <div
                className="flex h-3 w-full overflow-hidden rounded-full"
                role="img"
                aria-label={t('dashboard.composition.title')}
              >
                {buckets.map((b) => (
                  <div
                    key={b.key}
                    className={b.color}
                    style={{ width: `${(b.count / sceneCount) * 100}%` }}
                    title={`${t(b.labelKey)}: ${b.count}`}
                  />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {buckets.map((b) => (
                  <li
                    key={b.key}
                    className="flex items-center gap-1.5 text-xs text-[var(--sc-text-secondary)]"
                  >
                    <span className={`h-2.5 w-2.5 rounded-sm ${b.color}`} aria-hidden="true" />
                    {t(b.labelKey)}
                    <span className="font-bold tabular-nums text-[var(--sc-text-primary)]">
                      {b.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
