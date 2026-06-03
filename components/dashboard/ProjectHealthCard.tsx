import type { FC } from 'react';
import { useDashboardContext } from '../../contexts/DashboardContext';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Progress } from '../ui/Progress';

// QNBS-v3: Radial gauge replaces the bare number — SVG stroke-dashoffset arc, no chart dependency.
const RadialGauge: FC<{ score: number; label: string }> = ({ score, label }) => {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  // Color the arc by band — danger / warning / success tokens keep it theme-aware.
  const stroke =
    score >= 70
      ? 'var(--sc-success-fg)'
      : score >= 40
        ? 'var(--sc-warning-fg)'
        : 'var(--sc-danger-fg)';

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--sc-surface-overlay)"
          strokeWidth="10"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tabular-nums text-[var(--sc-text-primary)]">
          {score}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--sc-text-muted)]">
          {label}
        </span>
      </div>
    </div>
  );
};

const BreakdownBar: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="min-w-0 break-words text-xs font-semibold text-[var(--sc-text-secondary)]">
        {label}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-[var(--sc-text-muted)]">{value}%</span>
    </div>
    <Progress value={value} className="h-1.5" />
  </div>
);

export const ProjectHealthCard: FC = () => {
  const { enableProjectHealthScore } = useFeatureFlags();
  const { t, healthBreakdown } = useDashboardContext();

  if (!enableProjectHealthScore) return null;

  return (
    <Card
      className="animate-in h-full border-[var(--sc-border-subtle)]"
      style={{ '--index': 3 } as React.CSSProperties}
    >
      <CardHeader className="border-b border-[var(--sc-border-subtle)] pb-4">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.healthScore.title')}
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-5 pt-4 sm:flex-row sm:items-center">
        <RadialGauge score={healthBreakdown.score} label={t('dashboard.healthScore.scoreLabel')} />
        <div className="w-full flex-1 space-y-3">
          <BreakdownBar
            label={t('dashboard.healthScore.writing')}
            value={healthBreakdown.writing}
          />
          <BreakdownBar label={t('dashboard.healthScore.cast')} value={healthBreakdown.cast} />
          <BreakdownBar label={t('dashboard.healthScore.world')} value={healthBreakdown.world} />
          <p className="pt-1 text-xs leading-relaxed text-[var(--sc-text-muted)]">
            {t('dashboard.healthScore.body')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
