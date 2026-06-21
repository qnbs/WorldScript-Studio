/**
 * OllamaDevicePull — device-aware Ollama model recommendation + one-click pull.
 * QNBS-v3: profiles the device (getHealthReport) → getOllamaModelForDevice picks a tag, then
 * pullOllamaModel streams /api/pull progress with cancel + error-retry. Self-contained so AiSections
 * stays lean; all network failure modes (unreachable server, inline error, abort) are surfaced.
 */

import { type FC, useEffect, useRef, useState } from 'react';
import type { useTranslation } from '../../hooks/useTranslation';
import { getHealthReport } from '../../services/ai/deviceHealthService';
import {
  getOllamaModelForDevice,
  type OllamaDeviceRecommendation,
} from '../../services/ai/modelRecommendations';
import { logger } from '../../services/logger';
import { type OllamaPullProgress, pullOllamaModel } from '../../services/ollamaService';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

type Translate = ReturnType<typeof useTranslation>['t'];

interface OllamaDevicePullProps {
  baseUrl: string;
  /** Apply the pulled model as the active Ollama model (e.g. set advancedAi.model). */
  onUseModel: (ollamaModelTag: string) => void;
  t: Translate;
}

type PullState = 'idle' | 'pulling' | 'success' | 'error';

export const OllamaDevicePull: FC<OllamaDevicePullProps> = ({ baseUrl, onUseModel, t }) => {
  const [rec, setRec] = useState<OllamaDeviceRecommendation | null>(null);
  const [state, setState] = useState<PullState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // QNBS-v3: profile the device once on mount; failure is non-fatal (just no recommendation chip).
  useEffect(() => {
    let active = true;
    void getHealthReport()
      .then((report) => {
        if (active) setRec(getOllamaModelForDevice(report));
      })
      .catch((err: unknown) => logger.warn('Device profile for Ollama recommendation failed', err));
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, []);

  if (!rec) return null;

  const onProgress = (p: OllamaPullProgress) => {
    setStatusText(p.status);
    if (typeof p.progress === 'number') setProgress(p.progress);
  };

  const startPull = async () => {
    // QNBS-v3: in-flight guard — never start a second pull while one is running, so two controllers
    // can't race (and so a stale finally can't clear a newer request's abort ref).
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setState('pulling');
    setProgress(0);
    setError('');
    try {
      await pullOllamaModel(rec.modelId, { baseUrl, signal: controller.signal, onProgress });
      setState('success');
    } catch (err) {
      // QNBS-v3: an aborted pull returns to idle (user-initiated cancel), not the error state.
      if ((err as { name?: string })?.name === 'AbortError') {
        setState('idle');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    } finally {
      // QNBS-v3: only clear the ref if it still points to THIS controller — defends against a late
      // resolution nulling a newer pull's controller and breaking its Cancel.
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const pct = Math.round(progress * 100);

  return (
    <div className="mb-3 rounded-sc-md border border-[var(--sc-border-subtle)] p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-[var(--sc-text-secondary)]">
          {t('settings.advancedAi.ollamaPull.recommendedFor')}
        </span>
        <code className="text-xs text-[var(--sc-text-primary)]">{rec.modelId}</code>
        <Badge variant="new">{t(`settings.advancedAi.ollamaPull.tier.${rec.tier}`)}</Badge>
        <span className="text-[10px] text-[var(--sc-text-muted)]">{rec.sizeHint}</span>
      </div>

      {rec.downgradedForBattery && (
        <p className="text-[10px] text-[var(--sc-warning-fg)]">
          {t('settings.advancedAi.ollamaPull.batteryNote')}
        </p>
      )}

      {state === 'pulling' && (
        <div className="space-y-1">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sc-surface-overlay)]/40"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('settings.advancedAi.ollamaPull.pulling')}
          >
            <div
              className="h-full bg-[var(--sc-accent)] transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-[var(--sc-text-muted)]">
            {statusText} {pct > 0 ? `· ${pct}%` : ''}
          </p>
        </div>
      )}

      {state === 'error' && (
        <p className="text-[10px] text-[var(--sc-danger-fg)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        {state === 'idle' && (
          <Button size="sm" variant="secondary" onClick={() => void startPull()}>
            {t('settings.advancedAi.ollamaPull.pull')}
          </Button>
        )}
        {state === 'pulling' && (
          <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
            {t('common.cancel')}
          </Button>
        )}
        {state === 'error' && (
          <Button size="sm" variant="secondary" onClick={() => void startPull()}>
            {t('settings.advancedAi.ollamaPull.retry')}
          </Button>
        )}
        {state === 'success' && (
          <>
            <span className="text-xs text-[var(--sc-success-fg)]">
              {t('settings.advancedAi.ollamaPull.installed')}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onUseModel(`ollama/${rec.modelId}`)}
            >
              {t('settings.advancedAi.ollamaPull.useModel')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
