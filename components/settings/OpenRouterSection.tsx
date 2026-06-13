/**
 * OpenRouterSection — Settings panel for OpenRouter cloud gateway.
 * QNBS-v3: API key stored via storageService (AES-256-GCM at rest); enabled/preferredModel
 * are non-sensitive and live in Redux so the routing chain can read them synchronously.
 */

import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { statusActions } from '../../features/status/statusSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { assertCloudAiAllowed } from '../../services/ai/aiPolicy';
import {
  clearOpenRouterModelCache,
  fetchOpenRouterModels,
  isOpenRouterFreeModel,
  type OpenRouterModel,
  validateOpenRouterKey,
} from '../../services/ai/openrouterModels';
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
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';

const CUSTOM_MODEL_VALUE = '__custom__';

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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            aria-label={t('settings.openRouter.resetCircuitAria')}
          >
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
  const aiMode = useAppSelector((s) => s.settings.aiMode);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const enabled = openRouterSettings?.enabled ?? false;
  const preferredModel = openRouterSettings?.preferredModel ?? 'deepseek/deepseek-r1:free';

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const hasStoredKey = Boolean(storedKey);
  const [isKeyLoading, setIsKeyLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const [policyBlocked, setPolicyBlocked] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(
    !OPENROUTER_FREE_MODELS.includes(preferredModel as (typeof OPENROUTER_FREE_MODELS)[number]),
  );
  const [customModelInput, setCustomModelInput] = useState(isCustomModel ? preferredModel : '');
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load stored key status on mount.
  useEffect(() => {
    let cancelled = false;
    storageService
      .getApiKey('openrouter')
      .then((k) => {
        if (!cancelled) setStoredKey(k);
      })
      .catch((err) => {
        logger.error('OpenRouter: failed to read stored API key status', { error: String(err) });
      })
      .finally(() => {
        if (!cancelled) setIsKeyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const guardPolicy = useCallback(async () => {
    try {
      await assertCloudAiAllowed('openrouter');
      setPolicyBlocked(false);
      return true;
    } catch {
      setPolicyBlocked(true);
      return false;
    }
  }, []);

  // Fetch model catalog when the section mounts.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setIsModelsLoading(true);
      setModelFetchError(null);
      const allowed = await guardPolicy();
      if (!allowed) {
        if (!cancelled) setIsModelsLoading(false);
        return;
      }
      try {
        const fetched = await fetchOpenRouterModels(storedKey ?? undefined);
        if (!cancelled) setModels(fetched);
      } catch (err) {
        logger.warn('OpenRouter: failed to fetch model catalog', { error: String(err) });
        if (!cancelled) {
          setModelFetchError(t('settings.openRouter.modelFetch.failed'));
          // QNBS-v3: Drop stale paid models on error so the Select only offers guaranteed options.
          setModels([]);
        }
      } finally {
        if (!cancelled) setIsModelsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [guardPolicy, storedKey, t]);

  // Keep local custom-model state in sync with external Redux changes.
  useEffect(() => {
    const free = OPENROUTER_FREE_MODELS.includes(
      preferredModel as (typeof OPENROUTER_FREE_MODELS)[number],
    );
    const knownPaid = models.some((m) => m.id === preferredModel);
    setIsCustomModel(!free && !knownPaid);
    if (free || knownPaid) setCustomModelInput('');
    else setCustomModelInput(preferredModel);
  }, [preferredModel, models]);

  const showSaveMsg = useCallback((ok: boolean, text: string) => {
    setSaveMsg({ ok, text });
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 4_000);
  }, []);

  const announceError = useCallback(
    (title: string, description: string) => {
      dispatch(statusActions.addNotification({ type: 'error', title, description }));
    },
    [dispatch],
  );

  const handleSaveKey = useCallback(async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      showSaveMsg(false, t('settings.openRouter.keyError.empty'));
      return;
    }
    setIsSaving(true);
    setSaveMsg(null);
    setTestResult(null);
    try {
      await storageService.saveApiKey('openrouter', trimmed);
      setApiKeyInput('');
      setStoredKey(trimmed);
      // QNBS-v3: Clear model cache and in-memory list so the next fetch can include private models for this key.
      clearOpenRouterModelCache();
      setModels([]);
      showSaveMsg(true, t('settings.openRouter.keyStatus.saved'));
    } catch (err) {
      logger.error('OpenRouter: failed to save API key', { error: String(err) });
      showSaveMsg(false, t('settings.openRouter.keyError.saveFailed'));
      announceError(
        t('settings.openRouter.errors.generic'),
        t('settings.openRouter.keyError.saveFailed'),
      );
    } finally {
      setIsSaving(false);
    }
  }, [apiKeyInput, t, showSaveMsg, announceError]);

  const handleClearKey = useCallback(async () => {
    try {
      await storageService.clearApiKey('openrouter');
      setStoredKey(null);
      setApiKeyInput('');
      setSaveMsg(null);
      setTestResult(null);
      clearOpenRouterModelCache();
      setModels([]);
    } catch (err) {
      logger.error('OpenRouter: failed to clear API key', { error: String(err) });
      announceError(
        t('settings.openRouter.errors.generic'),
        t('settings.openRouter.keyError.saveFailed'),
      );
    }
  }, [t, announceError]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    // QNBS-v3: Clear any lingering save status (and its 4s timer) so the test-connection
    // result isn't hidden behind the higher-priority saveMsg in the status renderer.
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    setSaveMsg(null);
    const allowed = await guardPolicy();
    if (!allowed) {
      setTestResult({ ok: false, text: t('settings.openRouter.policyBlocked') });
      setIsTesting(false);
      return;
    }
    if (!storedKey) {
      setTestResult({ ok: false, text: t('settings.openRouter.keyError.empty') });
      setIsTesting(false);
      return;
    }
    try {
      const result = await validateOpenRouterKey(storedKey);
      if (result.ok) {
        setTestResult({ ok: true, text: t('settings.openRouter.testConnectionOk') });
      } else if (result.error === 'INVALID_KEY') {
        setTestResult({ ok: false, text: t('settings.openRouter.keyError.invalid') });
      } else if (result.error === 'TIMEOUT' || result.error === 'NETWORK_ERROR') {
        setTestResult({ ok: false, text: t('settings.openRouter.keyError.network') });
      } else {
        setTestResult({ ok: false, text: t('settings.openRouter.testConnectionFailed') });
      }
    } catch (err) {
      logger.error('OpenRouter: connection test failed', { error: String(err) });
      setTestResult({ ok: false, text: t('settings.openRouter.testConnectionFailed') });
    } finally {
      setIsTesting(false);
    }
  }, [guardPolicy, storedKey, t]);

  const handleModelChange = useCallback(
    (value: string) => {
      if (value === CUSTOM_MODEL_VALUE) {
        setIsCustomModel(true);
      } else {
        setIsCustomModel(false);
        setCustomModelInput('');
        dispatch(settingsActions.setOpenRouter({ preferredModel: value }));
      }
    },
    [dispatch],
  );

  const commitCustomModel = useCallback(() => {
    const trimmed = customModelInput.trim();
    if (trimmed) dispatch(settingsActions.setOpenRouter({ preferredModel: trimmed }));
  }, [customModelInput, dispatch]);

  const handleCustomModelBlur = useCallback(() => {
    commitCustomModel();
  }, [commitCustomModel]);

  const handleCustomModelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCustomModel();
      }
    },
    [commitCustomModel],
  );

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    };
  }, []);

  const knownPaidIds = useMemo(() => new Set(models.map((m) => m.id)), [models]);

  const selectValue = useMemo(() => {
    if (isCustomModel) return CUSTOM_MODEL_VALUE;
    const free = OPENROUTER_FREE_MODELS.includes(
      preferredModel as (typeof OPENROUTER_FREE_MODELS)[number],
    );
    // QNBS-v3: Paid catalog models are known by id, so keep the real value instead of falling back to custom.
    if (free || knownPaidIds.has(preferredModel)) return preferredModel;
    return CUSTOM_MODEL_VALUE;
  }, [isCustomModel, preferredModel, knownPaidIds]);

  const modelOptions = useMemo(
    () =>
      OPENROUTER_FREE_MODELS.map((m) => ({
        value: m,
        label: t(
          `settings.openRouter.freeModel.${
            {
              'deepseek/deepseek-r1:free': 'deepseekR1',
              'meta-llama/llama-3.3-70b-instruct:free': 'llama3370b',
              'qwen/qwen2.5-72b-instruct:free': 'qwen2572b',
              'google/gemma-3-27b-it:free': 'gemma327b',
              'mistralai/mistral-7b-instruct:free': 'mistral7b',
            }[m]
          }`,
        ),
      })),
    [t],
  );

  const fetchedPaidOptions = useMemo(() => {
    const freeIds = new Set<string>(OPENROUTER_FREE_MODELS);
    return models
      .filter((m) => !freeIds.has(m.id) && !isOpenRouterFreeModel(m.id))
      .map((m) => ({ value: m.id, label: m.name ?? m.id }));
  }, [models]);

  const modelGroups = useMemo(() => {
    const groups: { label: string; options: { value: string; label: string }[] }[] = [
      { label: t('settings.openRouter.freeTierNote'), options: modelOptions },
    ];
    if (fetchedPaidOptions.length > 0) {
      groups.push({ label: t('settings.openRouter.paidModelNote'), options: fetchedPaidOptions });
    }
    groups.push({
      label: t('settings.openRouter.customModelLabel'),
      options: [{ value: CUSTOM_MODEL_VALUE, label: t('settings.openRouter.customModelLabel') }],
    });
    return groups;
  }, [modelOptions, fetchedPaidOptions, t]);

  const modeWarning = useMemo(() => {
    if (aiMode === 'local') return t('settings.openRouter.modeWarning.local');
    if (isOffline) return t('settings.openRouter.modeWarning.offline');
    return null;
  }, [aiMode, isOffline, t]);

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
          <div className="space-y-2">
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
                aria-describedby="openrouter-enabled-hint"
                onClick={() => dispatch(settingsActions.setOpenRouter({ enabled: !enabled }))}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] ${
                  enabled ? 'bg-[var(--sc-accent)]' : 'bg-[var(--sc-surface-raised)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-[var(--sc-surface-inverse)] shadow-lg ring-0 transition-transform duration-200 ${
                    enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p id="openrouter-enabled-hint" className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.openRouter.enabledHint')}
            </p>
            {modeWarning && (
              <p className="text-xs text-[var(--sc-warning-fg)]" role="status" aria-live="polite">
                {modeWarning}
              </p>
            )}
            {policyBlocked && (
              <p className="text-xs text-[var(--sc-danger-fg)]" role="alert" aria-live="polite">
                {t('settings.openRouter.policyBlocked')}
              </p>
            )}
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label
              htmlFor="openrouter-api-key"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('settings.openRouter.apiKey')}
            </label>
            {isKeyLoading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--sc-text-muted)]">
                <Spinner className="h-3 w-3" />
                {t('settings.openRouter.keyStatus.saving')}
              </div>
            ) : hasStoredKey ? (
              <p className="text-xs text-[var(--sc-success-fg)]" id="openrouter-key-status">
                {t('settings.openRouter.keyStatus.set')}
              </p>
            ) : (
              <p className="text-xs text-[var(--sc-text-muted)]" id="openrouter-key-status">
                {t('settings.openRouter.keyStatus.unset')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                id="openrouter-api-key"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={t('settings.openRouter.apiKeyPlaceholder')}
                className="flex-1 min-w-[12rem]"
                autoComplete="new-password"
                aria-describedby="openrouter-api-key-hint openrouter-key-status"
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleTestConnection()}
                disabled={isTesting || isKeyLoading || !hasStoredKey}
                aria-busy={isTesting}
              >
                {isTesting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  t('settings.openRouter.testConnection')
                )}
              </Button>
              {hasStoredKey && (
                <Button variant="ghost" size="sm" onClick={() => void handleClearKey()}>
                  {t('settings.openRouter.clearKey')}
                </Button>
              )}
            </div>
            {(saveMsg || testResult) && (
              <p
                className={`text-xs ${
                  (saveMsg?.ok ?? testResult?.ok)
                    ? 'text-[var(--sc-success-fg)]'
                    : 'text-[var(--sc-danger-fg)]'
                }`}
                role="status"
                aria-live="polite"
              >
                {saveMsg?.text ?? testResult?.text}
              </p>
            )}
            <p id="openrouter-api-key-hint" className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.openRouter.apiKeyHint')}{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[var(--sc-text-secondary)]"
              >
                {t('settings.openRouter.getKeyLink')}
              </a>
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
            {isModelsLoading && (
              <div className="flex items-center gap-2 text-xs text-[var(--sc-text-muted)]">
                <Spinner className="h-3 w-3" />
                {t('settings.openRouter.modelFetch.loading')}
              </div>
            )}
            {modelFetchError && (
              <p className="text-xs text-[var(--sc-danger-fg)]" role="alert">
                {modelFetchError}
              </p>
            )}
            {!isModelsLoading && (
              <Select
                id="openrouter-model"
                value={selectValue}
                onChange={handleModelChange}
                groups={modelGroups}
                placeholder={t('settings.openRouter.modelPlaceholder')}
                ariaLabel={t('settings.openRouter.modelAriaLabel')}
                searchable
                searchPlaceholder={t('settings.openRouter.modelPlaceholder')}
              />
            )}
            {isCustomModel && (
              <Input
                type="text"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
                onBlur={handleCustomModelBlur}
                onKeyDown={handleCustomModelKeyDown}
                placeholder={t('settings.openRouter.customModelPlaceholder')}
                aria-label={t('settings.openRouter.customModelAriaLabel')}
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
