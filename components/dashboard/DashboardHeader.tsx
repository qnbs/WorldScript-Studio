import type { FC } from 'react';
import { ICONS } from '../../constants';
import { useDashboardContext } from '../../contexts/DashboardContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { BookOpenIcon, FlameIcon } from './dashboardIcons';

// QNBS-v3: Personalized hero — time-aware greeting + the single most useful action on the
// dashboard (jump back into the manuscript). Replaces the previously greeting-less top of page.
const Chip: FC<{ icon: React.ReactNode; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <div className="flex items-center gap-2 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]/60 px-3 py-1.5 backdrop-blur-sm">
    <span className="text-[var(--sc-accent)]">{icon}</span>
    <span className="text-sm font-bold tabular-nums text-[var(--sc-text-primary)]">{value}</span>
    <span className="text-xs text-[var(--sc-text-muted)]">{label}</span>
  </div>
);

export const DashboardHeader: FC = () => {
  const {
    t,
    project,
    greetingKey,
    continueSection,
    onNavigate,
    streakDays,
    wordCount,
    readingTimeMinutes,
  } = useDashboardContext();

  return (
    <Card
      as="section"
      aria-label={t('dashboard.header.ariaLabel')}
      className="animate-in relative overflow-hidden p-6 sm:p-8"
      style={{ '--index': 0 } as React.CSSProperties}
    >
      {/* QNBS-v3: decorative accent wash — token-driven so it adapts to every appearance preset. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[var(--sc-accent)]/10 blur-3xl"
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--sc-accent)]">
            {t(greetingKey)}
          </p>
          <h1 className="mt-2 truncate text-3xl font-black tracking-tight text-[var(--sc-text-primary)] sm:text-4xl">
            {project.title || t('dashboard.details.projectTitlePlaceholder')}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--sc-text-secondary)] line-clamp-2">
            {project.logline || t('dashboard.noLogline')}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {streakDays > 0 ? (
              <Chip
                icon={<FlameIcon className="w-4 h-4" />}
                value={String(streakDays)}
                label={t('dashboard.momentum.dayStreak')}
              />
            ) : null}
            <Chip
              icon={
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.6}
                  stroke="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  {ICONS.WRITER}
                </svg>
              }
              value={wordCount.toLocaleString()}
              label={t('common.words')}
            />
            {readingTimeMinutes > 0 ? (
              <Chip
                icon={<BookOpenIcon className="w-4 h-4" />}
                value={t('dashboard.composition.readingTimeValue', {
                  count: String(readingTimeMinutes),
                })}
                label={t('dashboard.composition.readingTime')}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => onNavigate('manuscript')}
            className="gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="w-5 h-5"
              aria-hidden="true"
            >
              {ICONS.CONTINUE}
            </svg>
            {t('dashboard.continueWriting.button')}
          </Button>
          {continueSection ? (
            <p className="max-w-[16rem] truncate text-right text-xs text-[var(--sc-text-muted)]">
              {t('dashboard.header.lastEdited', { title: continueSection.title })}
            </p>
          ) : (
            <p className="max-w-[16rem] text-right text-xs text-[var(--sc-text-muted)]">
              {t('dashboard.continueWriting.empty')}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
