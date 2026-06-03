import type { FC } from 'react';
import { useMemo } from 'react';
import { useDashboardContext } from '../../contexts/DashboardContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { FlameIcon, TrophyIcon } from './dashboardIcons';

// QNBS-v3: 14-day activity sparkline — pure presentational SVG bars, scaled to the busiest day.
const ActivitySparkline: FC<{
  data: { date: string; words: number; isToday: boolean }[];
  emptyLabel: string;
}> = ({ data, emptyLabel }) => {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.words)), [data]);
  const hasAny = data.some((d) => d.words > 0);

  if (!hasAny) {
    return <p className="text-xs text-[var(--sc-text-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="flex h-16 items-end gap-1" role="img" aria-label={emptyLabel}>
      {data.map((d) => {
        const pct = Math.round((d.words / max) * 100);
        return (
          <div
            key={d.date}
            className="group/bar relative flex flex-1 items-end"
            style={{ height: '100%' }}
          >
            <div
              className={`w-full rounded-t-sm transition-all duration-500 ${
                d.isToday
                  ? 'bg-[var(--sc-accent)]'
                  : d.words > 0
                    ? 'bg-[var(--sc-accent)]/40 group-hover/bar:bg-[var(--sc-accent)]/70'
                    : 'bg-[var(--sc-surface-overlay)]'
              }`}
              style={{ height: `${Math.max(d.words > 0 ? 8 : 4, pct)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
};

const GoalRow: FC<{ label: string; current: number; goal: number; progress: number }> = ({
  label,
  current,
  goal,
  progress,
}) => {
  const { t } = useDashboardContext();
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-[var(--sc-text-secondary)]">{label}</span>
        <span className="text-xs tabular-nums text-[var(--sc-text-muted)]">
          {t('dashboard.momentum.ofGoal', {
            current: current.toLocaleString(),
            goal: goal.toLocaleString(),
          })}
        </span>
      </div>
      <Progress value={progress} className="h-2.5" />
    </div>
  );
};

export const WritingMomentumCard: FC = () => {
  const {
    t,
    streakDays,
    longestStreak,
    wordsToday,
    wordsThisWeek,
    dailyGoalWords,
    weeklyGoalWords,
    dailyGoalProgress,
    weeklyGoalProgress,
    recentActivity,
  } = useDashboardContext();

  const dailyGoalReached = dailyGoalProgress >= 100;

  return (
    <Card className="animate-in h-full" style={{ '--index': 2 } as React.CSSProperties}>
      <CardHeader className="flex items-center justify-between border-b-0 pb-0 pt-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.momentum.title')}
        </h2>
        <span className="flex items-center gap-1.5 text-[var(--sc-text-muted)]">
          <TrophyIcon className="w-4 h-4" />
          <span className="text-xs font-semibold tabular-nums">
            {t('dashboard.momentum.longest', { count: String(longestStreak) })}
          </span>
        </span>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border ${
              streakDays > 0
                ? 'border-orange-500/30 bg-orange-500/10 text-orange-500'
                : 'border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)]'
            }`}
          >
            <FlameIcon className="w-8 h-8" />
          </div>
          <div>
            <p className="text-3xl font-black tabular-nums text-[var(--sc-text-primary)]">
              {streakDays}
            </p>
            <p className="text-sm font-medium text-[var(--sc-text-secondary)]">
              {t('dashboard.momentum.dayStreak')}
            </p>
          </div>
          {dailyGoalReached ? (
            <span className="ml-auto self-start rounded-full bg-[var(--sc-success-bg)] px-2.5 py-1 text-xs font-bold text-[var(--sc-success-fg)]">
              {t('dashboard.momentum.goalReached')}
            </span>
          ) : null}
        </div>

        <div className="space-y-4">
          <GoalRow
            label={t('dashboard.momentum.today')}
            current={wordsToday}
            goal={dailyGoalWords}
            progress={dailyGoalProgress}
          />
          <GoalRow
            label={t('dashboard.momentum.thisWeek')}
            current={wordsThisWeek}
            goal={weeklyGoalWords}
            progress={weeklyGoalProgress}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
            {t('dashboard.momentum.activity')}
          </p>
          <ActivitySparkline
            data={recentActivity}
            emptyLabel={t('dashboard.momentum.noActivity')}
          />
        </div>
      </CardContent>
    </Card>
  );
};
