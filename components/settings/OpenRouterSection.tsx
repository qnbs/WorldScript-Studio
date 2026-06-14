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
  // QNBS-v3: Subscribe to online/offline events instead of reading navigator.onLine once at render —
  // otherwise the offline warning goes stale until an unrelated re-render happens to recompute it.
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const update = () =>
      setIsOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

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
  // QNBS-v3: Set once the user saves/clears a key, so a slower initial getApiKey load can't resolve
  // afterwards and overwrite the user's newer key state with a stale value.
  const keyOverriddenRef = useRef(false);

  // Load stored key status on mount.
  useEffect(() => {
    let cancelled = false;
    storageService
      .getApiKey('openrouter')
      .then((k) => {
        // QNBS-v3: Drop the result if the user already saved/cleared a key while this was in flight.
        if (!cancelled && !keyOverriddenRef.current) setStoredKey(k);
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

  // QNBS-v3: Monotonic guard so concurrent catalog fetches are last-wins — a slower or failing
  // response can never overwrite the result of a newer request, and a response that resolves after
  // unmount / key change is dropped instead of leaking state.
  const fetchSeqRef = useRef(0);
  // QNBS-v3: Guards the async connection-test result against key changes mid-flight.
  const testSeqRef = useRef(0);

  // QNBS-v3: Catalog fetch shared by the mount/key effect and the explicit post-save refresh.
  const fetchCatalog = useCallback(
    async (key: string | null) => {
      const seq = ++fetchSeqRef.current;
      const isLatest = () => fetchSeqRef.current === seq;
      setIsModelsLoading(true);
      setModelFetchError(null);
      const allowed = await guardPolicy();
      if (!allowed) {
        if (isLatest()) {
          // QNBS-v3: Cloud access is blocked — drop any previously loaded catalog so the Select
          // doesn't keep offering stale paid options the user can no longer reach.
          setModels([]);
          setIsModelsLoading(false);
        }
        return;
      }
      try {
        const fetched = await fetchOpenRouterModels(key ?? undefined);
        if (isLatest()) setModels(fetched);
      } catch (err) {
        logger.warn('OpenRouter: failed to fetch model catalog', { error: String(err) });
        if (isLatest()) {
          setModelFetchError(t('settings.openRouter.modelFetch.failed'));
          // QNBS-v3: Drop stale paid models on error so the Select only offers guaranteed options.
          setModels([]);
        }
      } finally {
        if (isLatest()) setIsModelsLoading(false);
      }
    },
    [guardPolicy, t],
  );

  // Fetch model catalog when the section mounts or the stored key changes.
  useEffect(() => {
    void fetchCatalog(storedKey);
    // QNBS-v3: Invalidate any in-flight fetch on unmount / re-run so a late response can't apply.
    return () => {
      fetchSeqRef.current++;
    };
  }, [fetchCatalog, storedKey]);

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
      // QNBS-v3: Detect a same-value save BEFORE updating state — React skips a no-op setStoredKey,
      // so the storedKey effect wouldn't re-run in that case.
      const keyUnchanged = trimmed === storedKey;
      await storageService.saveApiKey('openrouter', trimmed);
      // QNBS-v3: Mark the key as user-overridden only AFTER a successful save, so a failed save
      // doesn't suppress a still-in-flight initial load (which would wrongly show "no stored key").
      keyOverriddenRef.current = true;
      setApiKeyInput('');
      setStoredKey(trimmed);
      // QNBS-v3: Clear model cache and in-memory list so the next fetch can include private models for this key.
      clearOpenRouterModelCache();
      setModels([]);
      // QNBS-v3: Supersede any in-flight connection test (its late result can't apply to this key) AND
      // clear isTesting so the superseded test's sequence-guard early-return can't leave the spinner stuck.
      testSeqRef.current++;
      setIsTesting(false);
      // QNBS-v3: Only refetch explicitly when the key value is unchanged (effect won't re-run). When
      // the value changed, the storedKey effect performs the single refetch — avoids a double fetch
      // and the race it would create. The fetch sequence guard keeps either path last-wins.
      if (keyUnchanged) {
        void fetchCatalog(trimmed);
      }
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
  }, [apiKeyInput, storedKey, t, showSaveMsg, announceError, fetchCatalog]);

  const handleClearKey = useCallback(async () => {
    try {
      await storageService.clearApiKey('openrouter');
      // QNBS-v3: Mark as user-overridden only AFTER a successful clear, so a failed clear doesn't
      // suppress a still-in-flight initial load.
      keyOverriddenRef.current = true;
      setStoredKey(null);
      setApiKeyInput('');
      setSaveMsg(null);
      setTestResult(null);
      clearOpenRouterModelCache();
      setModels([]);
      // QNBS-v3: Supersede any in-flight connection test AND clear isTesting so the superseded test's
      // sequence-guard early-return can't leave the spinner/disabled state stuck.
      testSeqRef.current++;
      setIsTesting(false);
    } catch (err) {
      logger.error('OpenRouter: failed to clear API key', { error: String(err) });
      announceError(
        t('settings.openRouter.errors.generic'),
        t('settings.openRouter.keyError.saveFailed'),
      );
    }
  }, [t, announceError]);

  const handleTestConnection = useCallback(async () => {
    // QNBS-v3: Sequence guard so a result is never applied for an outdated key — if the user
    // changes/clears the key (or runs a newer test) while this request is in flight, testSeqRef is
    // bumped and this invocation's late response is dropped instead of showing a stale ok/fail.
    const seq = ++testSeqRef.current;
    const isLatest = () => testSeqRef.current === seq;
    setIsTesting(true);
    setTestResult(null);
    // QNBS-v3: Clear any lingering save status (and its 4s timer) so the test-connection
    // result isn't hidden behind the higher-priority saveMsg in the status renderer.
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    setSaveMsg(null);
    const allowed = await guardPolicy();
    if (!isLatest()) return;
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
      if (!isLatest()) return;
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
      if (isLatest())
        setTestResult({ ok: false, text: t('settings.openRouter.testConnectionFailed') });
    } finally {
      if (isLatest()) setIsTesting(false);
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
    if (trimmed) {
      dispatch(settingsActions.setOpenRouter({ preferredModel: trimmed }));
      return;
    }
    // QNBS-v3: Empty custom input — revert the selection to the actually-configured model so the UI
    // doesn't show "custom" selected while the stored model stays unchanged (keeps UI ↔ config in sync).
    const free = OPENROUTER_FREE_MODELS.includes(
      preferredModel as (typeof OPENROUTER_FREE_MODELS)[number],
    );
    const storedIsCustom = !free && !models.some((m) => m.id === preferredModel);
    setIsCustomModel(storedIsCustom);
    setCustomModelInput(storedIsCustom ? preferredModel : '');
  }, [customModelInput, dispatch, preferredModel, models]);

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

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
      // QNBS-v3: Invalidate any in-flight connection test so a late response can't call
      // setTestResult/setIsTesting on an unmounted component.
      testSeqRef.current++;
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
