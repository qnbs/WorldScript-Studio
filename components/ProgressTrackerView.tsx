import type { FC } from 'react';
import {
  ProgressTrackerContext,
  useProgressTrackerContext,
} from '../contexts/ProgressTrackerContext';
import { useProgressTrackerView } from '../hooks/useProgressTrackerView';
import { SectionIcon } from './ui/SectionIcon';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Circular Progress Ring ────────────────────────────────────────────────────

const ProgressRing: FC<{ pct: number; size?: number; stroke?: number; color?: string }> = ({
  pct,
  size = 96,
  stroke = 8,
  color = 'var(--sc-accent)',
}) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(pct / 100, 1));
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--sc-border-subtle)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};

// ── Velocity Chart (30-day area) ─────────────────────────────────────────────

const VelocityChart: FC<{ history: { date: string; words: number }[] }> = ({ history }) => {
  const { t } = useProgressTrackerContext();
  const last30 = [...history].slice(-30);
  if (last30.length === 0) {
    return (
      <p className="text-sm text-[var(--sc-text-secondary)] text-center mt-4">
        {t('progress.chart.noData')}
      </p>
    );
  }
  const maxWords = Math.max(...last30.map((d) => d.words), 1);
  const W = 400;
  const H = 100;
  const padX = 4;
  const padY = 8;
  const step = (W - padX * 2) / Math.max(last30.length - 1, 1);

  const points = last30.map((d, i) => ({
    x: padX + i * step,
    y: padY + (H - padY * 2) * (1 - d.words / maxWords),
  }));

  const pathD =
    points.length === 1
      ? `M ${points[0]!.x},${points[0]!.y}`
      : points.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(' ');

  const areaD = `${pathD} L ${points.at(-1)!.x},${H} L ${points[0]!.x},${H} Z`;

  // QNBS-v3: aria-hidden SVG + sr-only table gives screen readers actual data without visual clutter.
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="w-full h-24">
        <defs>
          <linearGradient id="velGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--sc-accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--sc-accent)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#velGrad)" />
        <path d={pathD} fill="none" stroke="var(--sc-accent)" strokeWidth={1.5} />
      </svg>
      <table
        className="sr-only"
        aria-label={t('progress.chart.ariaLabel', { count: String(last30.length) })}
      >
        <caption className="sr-only">
          {t('progress.chart.ariaLabel', { count: String(last30.length) })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('progress.chart.tableDate')}</th>
            <th scope="col">{t('progress.chart.tableWords')}</th>
          </tr>
        </thead>
        <tbody>
          {last30.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{d.words}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};

// ── Heatmap (12 weeks) ────────────────────────────────────────────────────────

const Heatmap: FC<{ history: { date: string; words: number }[] }> = ({ history }) => {
  const { t } = useProgressTrackerContext();
  const historyMap = new Map(history.map((h) => [h.date, h.words]));
  const maxWords = Math.max(...history.map((h) => h.words), 1);

  const weeks = 12;
  const days = 7;
  const today = new Date();
  const cells: { date: string; words: number; intensity: number }[] = [];

  for (let w = weeks - 1; w >= 0; w--) {
    for (let d = 0; d < days; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - w * 7 - (days - 1 - d));
      const dateStr = date.toISOString().slice(0, 10);
      const words = historyMap.get(dateStr) ?? 0;
      const intensity = words === 0 ? 0 : Math.ceil((words / maxWords) * 4);
      cells.push({ date: dateStr, words, intensity });
    }
  }

  const colors = ['var(--sc-surface-overlay)', '#bbf7d0', '#86efac', '#4ade80', '#16a34a'];

  return (
    <svg
      viewBox={`0 0 ${weeks * 12} ${days * 12}`}
      role="img"
      aria-label={t('progress.heatmap.ariaLabel')}
      className="w-full h-20"
    >
      {cells.map((cell, i) => {
        const col = Math.floor(i / days);
        const row = i % days;
        return (
          <rect
            key={cell.date}
            x={col * 12}
            y={row * 12}
            width={10}
            height={10}
            rx={2}
            fill={colors[cell.intensity] ?? colors[0]}
          >
            <title>{`${cell.date}: ${cell.words} words`}</title>
          </rect>
        );
      })}
    </svg>
  );
};

// ── Goal Input ────────────────────────────────────────────────────────────────

const GoalInput: FC<{
  label: string;
  value: number;
  onChange: (n: number) => void;
}> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-sm text-[var(--sc-text-secondary)] flex-1">{label}</span>
    <input
      type="number"
      min={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
      className="w-24 px-2 py-2 min-h-[44px] rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-sm text-right"
    />
  </div>
);

// ── Mini day bars (weekly breakdown) ─────────────────────────────────────────

const WeeklyBars: FC<{ history: { date: string; words: number }[]; goalPerDay: number }> = ({
  history,
  goalPerDay,
}) => {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const dateStr = d.toISOString().slice(0, 10);
    const words = history.find((h) => h.date === dateStr)?.words ?? 0;
    return { dateStr, words, label: d.toLocaleDateString(undefined, { weekday: 'short' }) };
  });
  const max = Math.max(...days.map((d) => d.words), goalPerDay);
  return (
    <div className="flex gap-1 items-end h-12" aria-hidden="true">
      {days.map((d) => (
        <div key={d.dateStr} className="flex flex-col items-center gap-0.5 flex-1">
          <div
            className="w-full rounded-t"
            style={{
              height: `${Math.round((d.words / max) * 40)}px`,
              background: d.words >= goalPerDay ? '#4ade80' : 'var(--sc-accent)',
              minHeight: d.words > 0 ? 2 : 0,
            }}
          />
          <span className="text-[10px] text-[var(--sc-text-secondary)]">{d.label}</span>
        </div>
      ))}
    </div>
  );
};

// ── Inner Component ───────────────────────────────────────────────────────────

const ProgressTrackerInner: FC = () => {
  const {
    t,
    dailyGoalWords,
    weeklyGoalWords,
    streakDays,
    longestStreak,
    totalWordsAllTime,
    wordsToday,
    wordsThisWeek,
    isSessionActive,
    sessionElapsed,
    sessionWordsDelta,
    writingHistory,
    setDailyGoal,
    setWeeklyGoal,
    handleStartSession,
    handleEndSession,
  } = useProgressTrackerContext();

  const dailyPct = dailyGoalWords > 0 ? (wordsToday / dailyGoalWords) * 100 : 0;
  const weeklyPct = weeklyGoalWords > 0 ? (wordsThisWeek / weeklyGoalWords) * 100 : 0;

  const bestDay = writingHistory.reduce((best, h) => (h.words > best.words ? h : best), {
    date: '',
    words: 0,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <SectionIcon section="progress" size="md" />
        <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">{t('progress.title')}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Today's progress */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.today.title')}
            </h2>
            <div className="flex items-center gap-4">
              <div className="relative">
                <ProgressRing pct={dailyPct} />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
                  {Math.round(dailyPct)}%
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--sc-text-primary)]">
                  {wordsToday.toLocaleString()}
                </p>
                <p className="text-sm text-[var(--sc-text-secondary)]">
                  {t('progress.today.ofGoal', { goal: String(dailyGoalWords.toLocaleString()) })}
                </p>
                {wordsToday < dailyGoalWords && (
                  <p className="text-xs text-[var(--sc-text-secondary)] mt-0.5">
                    {t('progress.today.remaining', {
                      n: String((dailyGoalWords - wordsToday).toLocaleString()),
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Session timer */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.session.title')}
            </h2>
            <p
              role="timer"
              className="text-3xl font-mono font-bold text-[var(--sc-text-primary)] mb-2"
              aria-label={t('progress.session.elapsed', { time: formatElapsed(sessionElapsed) })}
            >
              {formatElapsed(sessionElapsed)}
            </p>
            {isSessionActive && (
              <p className="text-sm text-[var(--sc-text-secondary)] mb-3">
                {t('progress.session.wordsWritten', { n: String(sessionWordsDelta) })}
              </p>
            )}
            <button
              type="button"
              onClick={isSessionActive ? handleEndSession : handleStartSession}
              className={`px-4 py-3 min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                isSessionActive
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-[white]'
              }`}
              aria-label={
                isSessionActive ? t('progress.session.stop') : t('progress.session.start')
              }
            >
              {isSessionActive ? t('progress.session.stop') : t('progress.session.start')}
            </button>
          </div>

          {/* Streak */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.streak.title')}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-4xl" aria-hidden="true">
                🔥
              </span>
              <div>
                <p className="text-2xl font-bold text-[var(--sc-text-primary)]">
                  {t('progress.streak.days', { n: String(streakDays) })}
                </p>
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  {t('progress.streak.longest', { n: String(longestStreak) })}
                </p>
              </div>
            </div>
          </div>

          {/* Weekly goal */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.weekly.title')}
            </h2>
            <div className="w-full h-2 rounded-full bg-[var(--sc-border-subtle)] mb-2">
              <div
                className="h-full rounded-full bg-[var(--sc-accent)] transition-all"
                style={{ width: `${Math.min(weeklyPct, 100)}%` }}
                role="progressbar"
                aria-valuenow={Math.round(weeklyPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('progress.weekly.progress')}
              />
            </div>
            <p className="text-sm text-[var(--sc-text-secondary)] mb-3">
              {wordsThisWeek.toLocaleString()} / {weeklyGoalWords.toLocaleString()}
            </p>
            <WeeklyBars history={writingHistory} goalPerDay={Math.round(weeklyGoalWords / 7)} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Velocity chart */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.chart.title')}
            </h2>
            <VelocityChart history={writingHistory} />
          </div>

          {/* Heatmap */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.heatmap.title')}
            </h2>
            <Heatmap history={writingHistory} />
          </div>

          {/* Best day */}
          {bestDay.words > 0 && (
            <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
              <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-2">
                {t('progress.bestDay.title')}
              </h2>
              <p className="text-xl font-bold text-[var(--sc-text-primary)]">
                {bestDay.words.toLocaleString()} {t('progress.bestDay.words')}
              </p>
              <p className="text-xs text-[var(--sc-text-secondary)]">{bestDay.date}</p>
            </div>
          )}

          {/* All-time total */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-2">
              {t('progress.allTime.title')}
            </h2>
            <p className="text-2xl font-bold text-[var(--sc-text-primary)]">
              {totalWordsAllTime.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--sc-text-secondary)]">{t('progress.allTime.label')}</p>
          </div>

          {/* Goal Settings */}
          <div className="bg-[var(--sc-surface-raised)] rounded-xl p-4 border border-[var(--sc-border-subtle)]">
            <h2 className="text-sm font-semibold text-[var(--sc-text-secondary)] uppercase tracking-wide mb-3">
              {t('progress.goals.title')}
            </h2>
            <div className="space-y-2">
              <GoalInput
                label={t('progress.goals.daily')}
                value={dailyGoalWords}
                onChange={setDailyGoal}
              />
              <GoalInput
                label={t('progress.goals.weekly')}
                value={weeklyGoalWords}
                onChange={setWeeklyGoal}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ProgressTrackerView: FC = () => {
  const contextValue = useProgressTrackerView();
  return (
    <ProgressTrackerContext.Provider value={contextValue}>
      <ProgressTrackerInner />
    </ProgressTrackerContext.Provider>
  );
};
