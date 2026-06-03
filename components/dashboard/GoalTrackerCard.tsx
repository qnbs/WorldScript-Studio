import type { FC } from 'react';
import { ICONS } from '../../constants';
import { useDashboardContext } from '../../contexts/DashboardContext';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { CalendarIcon, TrendingUpIcon } from './dashboardIcons';

// QNBS-v3: Extracted from Dashboard.tsx (file-size budget) and augmented with a pace projection —
// required words/day to hit the deadline plus an on-track / behind verdict.
const PACE_BADGE: Record<'done' | 'ontrack' | 'behind', { bg: string; fg: string; key: string }> = {
  done: {
    bg: 'bg-[var(--sc-success-bg)]',
    fg: 'text-[var(--sc-success-fg)]',
    key: 'dashboard.goals.pace.done',
  },
  ontrack: {
    bg: 'bg-[var(--sc-success-bg)]',
    fg: 'text-[var(--sc-success-fg)]',
    key: 'dashboard.goals.pace.onTrack',
  },
  behind: {
    bg: 'bg-[var(--sc-warning-bg)]',
    fg: 'text-[var(--sc-warning-fg)]',
    key: 'dashboard.goals.pace.behind',
  },
};

export const GoalTrackerCard: FC = () => {
  const {
    t,
    project,
    wordCount,
    wordCountProgress,
    daysLeft,
    openGoalModal,
    wordsRemaining,
    requiredPerDay,
    paceStatus,
  } = useDashboardContext();

  const renderDaysLeft = () => {
    if (daysLeft === null)
      return (
        <p className="text-xl font-bold text-[var(--sc-text-muted)]">
          {t('dashboard.goals.noDeadline')}
        </p>
      );
    let color = 'text-[var(--sc-text-primary)]';
    if (daysLeft < 0) color = 'text-[var(--sc-danger-fg)]';
    else if (daysLeft < 7) color = 'text-[var(--sc-warning-fg)]';

    const count = Math.abs(daysLeft);

    return (
      <div className="flex items-baseline gap-2">
        <span className={`text-4xl font-black tabular-nums ${color}`}>{count}</span>
        <span className="text-sm font-semibold uppercase tracking-wide text-[var(--sc-text-secondary)]">
          {daysLeft < 0
            ? t('dashboard.goals.overdue')
            : t('dashboard.goals.daysLeft', { count: '' }).replace(/\d+/, '').trim()}
        </span>
      </div>
    );
  };

  return (
    <Card
      className="animate-in flex h-full flex-col"
      style={{ '--index': 1 } as React.CSSProperties}
    >
      <CardHeader className="flex items-center justify-between border-b-0 pb-0 pt-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.goals.title')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={openGoalModal}
          aria-label={t('dashboard.goals.editGoal')}
          className="h-8 w-8 rounded-full p-0 hover:bg-[var(--sc-surface-overlay)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            {ICONS.TARGET}
          </svg>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-grow flex-col justify-center space-y-6 pt-4">
        <div>
          <div className="mb-3 flex items-end justify-between">
            <span className="text-4xl font-black tracking-tight tabular-nums text-[var(--sc-text-primary)]">
              {wordCount.toLocaleString()}
            </span>
            <span className="mb-1 text-sm font-medium text-[var(--sc-text-muted)]">
              / {project.projectGoals?.totalWordCount.toLocaleString()} {t('common.words')}
            </span>
          </div>
          <Progress value={wordCountProgress} className="h-4" />
          {wordsRemaining > 0 ? (
            <p className="mt-2 text-xs text-[var(--sc-text-muted)]">
              {t('dashboard.goals.wordsRemaining', { count: wordsRemaining.toLocaleString() })}
            </p>
          ) : (
            <p className="mt-2 text-xs font-semibold text-[var(--sc-success-fg)]">
              {t('dashboard.goals.pace.done')}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]/40 p-4 backdrop-blur-sm">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
              <CalendarIcon className="w-3.5 h-3.5" />
              {t('dashboard.goals.deadline')}
            </span>
            {renderDaysLeft()}
          </div>
          <div className="rounded-2xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)]/40 p-4 backdrop-blur-sm">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
              <TrendingUpIcon className="w-3.5 h-3.5" />
              {t('dashboard.goals.pace.title')}
            </span>
            {requiredPerDay !== null ? (
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black tabular-nums text-[var(--sc-text-primary)]">
                  {requiredPerDay.toLocaleString()}
                </span>
                <span className="text-xs font-semibold text-[var(--sc-text-secondary)]">
                  {t('dashboard.goals.pace.perDayUnit')}
                </span>
              </div>
            ) : (
              <p className="text-sm text-[var(--sc-text-muted)]">
                {paceStatus === 'done'
                  ? t('dashboard.goals.pace.done')
                  : t('dashboard.goals.pace.noDeadline')}
              </p>
            )}
            {paceStatus && PACE_BADGE[paceStatus] ? (
              <span
                className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${PACE_BADGE[paceStatus].bg} ${PACE_BADGE[paceStatus].fg}`}
              >
                {t(PACE_BADGE[paceStatus].key)}
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
