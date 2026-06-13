// QNBS-v3: Non-blocking banner shown during DuckDB seed/RAG-vector migration.
//          Reads from analyticsSlice.migrationStatus (already tracked there) — no duplicate state.
//          Dismisses automatically on 'done'; stays visible on 'error' until user dismisses.

import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from './Icon';
import { Progress } from './Progress';

export function DuckDbMigrationBanner() {
  const { t } = useTranslation();
  const migrationStatus = useAppSelector((state) => state.analytics.migrationStatus);
  const migrationError = useAppSelector((state) => state.analytics.migrationError);
  const featureEnabled = useAppSelector((state) => state.featureFlags.enableDuckDbAnalytics);

  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!featureEnabled) return;
    if (migrationStatus === 'running') {
      setVisible(true);
      setDismissed(false);
    } else if (migrationStatus === 'done') {
      // Auto-dismiss after 2 s so the user sees a brief success state
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    } else if (migrationStatus === 'error') {
      setVisible(true);
    }
    return undefined;
  }, [migrationStatus, featureEnabled]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setVisible(false);
  }, []);

  if (!visible || dismissed) return null;

  const isRunning = migrationStatus === 'running';
  const isError = migrationStatus === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="
        fixed bottom-4 left-1/2 z-[9998]
        -translate-x-1/2
        w-full max-w-sm
        rounded-[var(--radius-sc-lg)]
        border border-[var(--sc-border-subtle)]
        bg-[var(--sc-surface-overlay)]
        px-4 py-3
        shadow-lg
        backdrop-blur-sm
      "
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[var(--text-sc-sm)] font-medium text-[var(--sc-text-primary)]">
            {isError
              ? t('duckdb.migration.failed')
              : isRunning
                ? t('duckdb.migration.running')
                : t('duckdb.migration.complete')}
          </p>
          {isError && migrationError && (
            <p className="mt-0.5 text-[var(--text-sc-xs)] text-[var(--sc-danger-fg)] truncate">
              {migrationError}
            </p>
          )}
          {isRunning && (
            <div className="mt-2">
              {/* Indeterminate animation via cycling 0→80→0 — DuckDB doesn't report row counts */}
              <IndeterminateProgress />
            </div>
          )}
          {!isRunning && !isError && (
            <div className="mt-2">
              <Progress value={100} aria-label={t('duckdb.migration.complete')} />
            </div>
          )}
        </div>
        {(isError || !isRunning) && (
          <button
            type="button"
            aria-label={t('duckdb.migration.dismiss')}
            onClick={dismiss}
            className="
              shrink-0
              rounded-[var(--radius-sc-sm)]
              p-1
              text-[var(--sc-text-tertiary)]
              hover:bg-[var(--sc-surface-raised)]
              hover:text-[var(--sc-text-primary)]
              focus-visible:ring-2
              focus-visible:ring-[var(--sc-ring-focus)]
              focus-visible:outline-none
            "
          >
            <Icon name="close" size="sm" className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

DuckDbMigrationBanner.displayName = 'DuckDbMigrationBanner';

function IndeterminateProgress() {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--sc-surface-overlay)]">
      <div
        className="h-full w-1/2 rounded-full bg-[var(--sc-accent)]"
        style={{ animation: 'duckdb-indeterminate 1.5s ease-in-out infinite' }}
      />
      <style>{`
        @keyframes duckdb-indeterminate {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
