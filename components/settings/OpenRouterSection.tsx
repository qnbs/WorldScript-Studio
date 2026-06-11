/**
 * OpenRouterSection — Settings panel for OpenRouter cloud gateway.
 * QNBS-v3: API key stored via storageService (AES-256-GCM at rest); enabled/preferredModel
 * are non-sensitive and live in Redux so the routing chain can read them synchronously.
 */

import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import {
  getApproxRpm,
  isCircuitOpen,
  OPENROUTER_FREE_MODELS,
  resetOpenRouterCircuit,
} from '../../services/ai/providers/openrouterProvider';
import { logger } from '../../services/logger';
import { storageService } from '../../services/storageService';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

// ─── Sub-component: circuit breaker status indicator ─────────────────────────

const CircuitBreakerStatus: FC<{ t: ReturnType<typeof useTranslation>['t'] }> = ({ t }) => {
  const [open, setOpen] = useState(() => isCircuitOpen());
  const [rpm, setRpm] = useState(() => getApproxRpm());

  useEffect(() => {
    // QNBS-v3: Poll circuit state every 5 s — cheap local var check, no network.
    const id = setInterval(() => {
      setOpen(isCircuitOpen());
      setRpm(getApproxRpm());
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const handleReset = useCallback(() => {
    resetOpenRouterCircuit();
    setOpen(false);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              open ? 'animate-pulse bg-[var(--sc-danger-fg)]' : 'bg-[var(--sc-success-fg)]'
            }`}
          />
          <span className="text-sm text-[var(--sc-text-secondary)]">
            {t('settings.openRouter.circuitBreaker')}
          </span>
          <span
            className={`text-xs font-medium ${
              open ? 'text-[var(--sc-danger-fg)]' : 'text-[var(--sc-success-fg)]'
            }`}
            aria-live="polite"
          >
            {open ? t('settings.openRouter.circuitOpen') : t('settings.openRouter.circuitClosed')}
          </span>
        </div>
        {open && (
          <Button variant="ghost" size="sm" onClick={handleReset}>
            {t('settings.openRouter.resetCircuit')}
          </Button>
        )}
      </div>
      <p className="text-xs text-[var(--sc-text-muted)]">
        {t('settings.openRouter.rpmLabel')}: <strong>{rpm}</strong>
      </p>
    </div>
  );
};

// ─── Main section ─────────────────────────────────────────────────────────────

export const OpenRouterSection: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const openRouterSettings = useAppSelector((s) => s.settings.openRouter);

  const enabled = openRouterSettings?.enabled ?? false;
  const preferredModel = openRouterSettings?.preferredModel ?? 'deepseek/deepseek-r1:free';

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // QNBS-v3: Track if the model input is a custom (non-catalog) value.
  const [isCustomModel, setIsCustomModel] = useState(
    !OPENROUTER_FREE_MODELS.includes(preferredModel as (typeof OPENROUTER_FREE_MODELS)[number]),
  );
  const [customModelInput, setCustomModelInput] = useState(isCustomModel ? preferredModel : '');
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load stored key status on mount.
  useEffect(() => {
    storageService
      .getApiKey('openrouter')
      .then((k) => setHasStoredKey(Boolean(k)))
      .catch(() => setHasStoredKey(false));
  }, []);

  const handleSaveKey = useCallback(async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setSaveMsg({ ok: false, text: t('settings.apiKey.errorEmpty') });
      return;
    }
    setIsSaving(true);
    setSaveMsg(null);
    try {
      await storageService.saveApiKey('openrouter', trimmed);
      setApiKeyInput('');
      setHasStoredKey(true);
      setSaveMsg({ ok: true, text: t('settings.openRouter.keySaved') });
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
      saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 4_000);
    } catch (err) {
      logger.error('OpenRouter: failed to save API key', { error: String(err) });
      setSaveMsg({ ok: false, text: t('settings.apiKey.errorSave') });
    } finally {
      setIsSaving(false);
    }
  }, [apiKeyInput, t]);

  const handleClearKey = useCallback(async () => {
    try {
      await storageService.clearApiKey('openrouter');
      setHasStoredKey(false);
      setSaveMsg(null);
    } catch (err) {
      logger.error('OpenRouter: failed to clear API key', { error: String(err) });
    }
  }, []);

  const handleModelChange = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        setIsCustomModel(true);
      } else {
        setIsCustomModel(false);
        setCustomModelInput('');
        dispatch(settingsActions.setOpenRouter({ preferredModel: value }));
      }
    },
    [dispatch],
  );

  const handleCustomModelBlur = useCallback(() => {
    const trimmed = customModelInput.trim();
    if (trimmed) dispatch(settingsActions.setOpenRouter({ preferredModel: trimmed }));
  }, [customModelInput, dispatch]);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    };
  }, []);

  const selectValue = isCustomModel
    ? '__custom__'
    : OPENROUTER_FREE_MODELS.includes(preferredModel as (typeof OPENROUTER_FREE_MODELS)[number])
      ? preferredModel
      : '__custom__';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('settings.openRouter.title')}
          </h2>
          <p className="mt-1 text-sm text-[var(--sc-text-muted)]">
            {t('settings.openRouter.description')}
          </p>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor="openrouter-enabled"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('settings.openRouter.enabled')}
            </label>
            <button
              id="openrouter-enabled"
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => dispatch(settingsActions.setOpenRouter({ enabled: !enabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] ${
                enabled ? 'bg-[var(--sc-accent)]' : 'bg-[var(--sc-surface-raised)]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label
              htmlFor="openrouter-api-key"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('settings.openRouter.apiKey')}
            </label>
            {hasStoredKey && (
              <p className="text-xs text-[var(--sc-success-fg)]">
                {t('settings.openRouter.keySet')}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                id="openrouter-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={t('settings.openRouter.apiKeyPlaceholder')}
                className="flex-1"
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveKey();
                }}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSaveKey()}
                disabled={isSaving || !apiKeyInput.trim()}
                aria-busy={isSaving}
              >
                {isSaving ? <Spinner className="h-4 w-4" /> : t('settings.openRouter.saveKey')}
              </Button>
              {hasStoredKey && (
                <Button variant="ghost" size="sm" onClick={() => void handleClearKey()}>
                  {t('settings.openRouter.clearKey')}
                </Button>
              )}
            </div>
            {saveMsg && (
              <p
                className={`text-xs ${saveMsg.ok ? 'text-[var(--sc-success-fg)]' : 'text-[var(--sc-danger-fg)]'}`}
                role="status"
              >
                {saveMsg.text}
              </p>
            )}
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.openRouter.getKeyLink')}
            </p>
          </div>

          {/* Preferred model */}
          <div className="space-y-2">
            <label
              htmlFor="openrouter-model"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('settings.openRouter.preferredModel')}
            </label>
            <select
              id="openrouter-model"
              value={selectValue}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full rounded-sc-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] px-3 py-2 text-sm text-[var(--sc-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sc-border-focus)]"
            >
              {OPENROUTER_FREE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom__">{t('settings.openRouter.customModelLabel')}</option>
            </select>
            {isCustomModel && (
              <Input
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onBlur={handleCustomModelBlur}
                placeholder={t('settings.openRouter.modelPlaceholder')}
                aria-label={t('settings.openRouter.customModelLabel')}
              />
            )}
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.openRouter.freeTierNote')}
            </p>
          </div>

          {/* Circuit breaker + RPM */}
          <CircuitBreakerStatus t={t} />
        </CardContent>
      </Card>
    </div>
  );
};
