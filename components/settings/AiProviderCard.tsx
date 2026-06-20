import { ONNX_SUPPORTED_MODELS, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../services/ai/localBackendPresets';
import type { WebGpuAdapterInfo } from '../../services/ai/webGpuDetectorService';
import { detectWebGpuDetails } from '../../services/ai/webGpuDetectorService';
import {
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
} from '../../services/aiProviderService';
import { storageService } from '../../services/storageService';
import { isTauriRuntime } from '../../services/tauriRuntime';
import type { AdvancedAiSettings, AIProvider, LocalBackendPreset } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';

interface AiProviderCardProps {
  advancedAi: AdvancedAiSettings;
  onAdvancedAiPatch: (patch: Partial<AdvancedAiSettings>) => void;
  onProviderChange: (p: AIProvider) => void;
  onModelSelect?: (model: string) => void;
}

export const AiProviderCard: FC<AiProviderCardProps> = ({
  advancedAi,
  onAdvancedAiPatch,
  onProviderChange,
  onModelSelect,
}) => {
  const { t } = useTranslation();
  const provider = advancedAi.provider;
  const ollamaBaseUrl = advancedAi.ollamaBaseUrl;
  // QNBS-v3 (T0): canonical detection (`__TAURI_INTERNALS__`-aware); `__TAURI__` alone read as web
  // in the real desktop shell, hiding desktop-only provider affordances.
  const isDesktop = isTauriRuntime();
  const [openaiKey, setOpenaiKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanRows, setScanRows] = useState<{ labelKey: string; baseUrl: string; ok: boolean }[]>(
    [],
  );
  // QNBS-v3: GPU probe runs once when WebLLM tab is selected — no polling.
  const [gpuInfo, setGpuInfo] = useState<WebGpuAdapterInfo | null>(null);

  useEffect(() => {
    storageService
      .getApiKey('openai')
      .then((k) => setOpenaiKey(k ?? ''))
      .catch(() => {});
  }, []);

  const handleSaveOpenAiKey = useCallback(async () => {
    setIsSavingKey(true);
    try {
      if (openaiKey.trim()) {
        await storageService.saveApiKey('openai', openaiKey.trim());
      } else {
        await storageService.clearApiKey('openai');
      }
    } finally {
      setIsSavingKey(false);
    }
  }, [openaiKey]);

  const handleLoadOllamaModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const models = await listOllamaModels(ollamaBaseUrl);
      setOllamaModels(models);
    } catch {
      setOllamaModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, [ollamaBaseUrl]);

  const handleTest = useCallback(async () => {
    setTestStatus('loading');
    setTestError('');
    try {
      const result = await testAIConnection(provider, {
        ollamaBaseUrl,
        openAiCompatibleBaseUrl: advancedAi.openAiCompatibleBaseUrl,
      });
      if (result.ok) {
        setTestStatus('ok');
      } else {
        setTestStatus('error');
        setTestError(result.error ?? t('settings.ai.connectionFailed'));
      }
    } catch (e) {
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : t('settings.ai.unknownError'));
    }
  }, [provider, ollamaBaseUrl, advancedAi.openAiCompatibleBaseUrl, t]);

  const handleScanLocals = useCallback(async () => {
    setScanBusy(true);
    try {
      const rows = await scanLocalOpenAiCompatibleEndpoints();
      setScanRows(rows.map((r) => ({ labelKey: r.labelKey, baseUrl: r.baseUrl, ok: r.ok })));
    } finally {
      setScanBusy(false);
    }
  }, []);

  useEffect(() => {
    if (provider === 'ollama') {
      void handleLoadOllamaModels();
      void handleTest();
    } else if (provider === 'webllm') {
      void handleTest();
      // QNBS-v3: Probe WebGPU once on WebLLM selection; result shown as status badge.
      detectWebGpuDetails()
        .then(setGpuInfo)
        .catch(() => setGpuInfo({ status: 'unknown' }));
    }
  }, [provider, handleLoadOllamaModels, handleTest]);

  const providers: { id: AIProvider; label: string }[] = [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'ollama', label: 'Ollama (lokal)' },
    { id: 'webllm', label: t('settings.ai.providerWebllm') },
    { id: 'onnx', label: t('settings.ai.providerOnnx') },
    { id: 'transformers', label: t('settings.ai.providerTransformers') },
    { id: 'anthropic', label: 'Anthropic Claude' },
  ];

  const presetOptions: { id: LocalBackendPreset; labelKey: string }[] = [
    { id: 'ollama_default', labelKey: 'settings.ai.preset.ollamaDefault' },
    { id: 'lm_studio', labelKey: 'settings.ai.preset.lmStudio' },
    { id: 'vllm', labelKey: 'settings.ai.preset.vllm' },
    { id: 'custom', labelKey: 'settings.ai.preset.custom' },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
          {t('settings.ai.providerTitle')}
        </h2>
        <p className="text-sm text-[var(--sc-text-muted)] mt-1">
          {t('settings.ai.providerDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {providers.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onProviderChange(p.id);
                setTestStatus('idle');
              }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${provider === p.id ? 'bg-[var(--sc-accent)] border-[var(--sc-accent)] text-[var(--sc-text-on-accent)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:border-[var(--border-interactive)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--sc-text-secondary)]">
              {t('settings.ai.providerStatusLabel')}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                testStatus === 'ok'
                  ? 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]'
                  : testStatus === 'error'
                    ? 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)]'
                    : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]'
              }`}
            >
              {testStatus === 'ok' && t('settings.ai.providerStatusConnected')}
              {testStatus === 'error' && t('settings.ai.providerStatusDisconnected')}
              {testStatus === 'idle' && t('settings.ai.providerStatusReady')}
            </span>
          </div>
          {testStatus === 'error' && testError && (
            <p className="text-xs text-[var(--sc-danger-fg)]">{testError}</p>
          )}
        </div>

        {provider === 'gemini' && (
          <div className="p-3 rounded-lg bg-[var(--sc-surface-raised)] text-sm text-[var(--sc-text-secondary)]">
            {t('settings.ai.geminiSelected')}
          </div>
        )}

        {provider === 'openai' && (
          <div className="space-y-3">
            <label
              htmlFor="openai-api-key"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.openaiKey')}
            </label>
            <div className="flex gap-2">
              <Input
                id="openai-api-key"
                type="password"
                placeholder="sk-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleSaveOpenAiKey} disabled={isSavingKey} variant="secondary">
                {isSavingKey ? <Spinner className="w-4 h-4" /> : t('settings.ai.save')}
              </Button>
            </div>
            <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.ai.keysEncrypted')}</p>
            {/* QNBS-v3: OpenRouter/Groq nutzen denselben Key-Slot + Root-URL — vermeidet Provider-Enum-Explosion. */}
            <label
              htmlFor="openai-compat-base-url"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.openAiCompatUrl')}
            </label>
            <Input
              id="openai-compat-base-url"
              placeholder="https://api.openai.com or https://openrouter.ai/api"
              value={advancedAi.openAiCompatibleBaseUrl}
              onChange={(e) => onAdvancedAiPatch({ openAiCompatibleBaseUrl: e.target.value })}
              className="font-mono text-sm"
            />
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.ai.openAiCompatHint')}
            </p>
            <label
              htmlFor="openai-site-url"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.openAiSiteUrl')}
            </label>
            <Input
              id="openai-site-url"
              placeholder="https://…"
              value={advancedAi.openAiSiteUrl}
              onChange={(e) => onAdvancedAiPatch({ openAiSiteUrl: e.target.value })}
              className="font-mono text-sm"
            />
            <label
              htmlFor="openai-site-title"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.openAiSiteTitle')}
            </label>
            <Input
              id="openai-site-title"
              placeholder={t('settings.ai.openAiSiteTitlePlaceholder')}
              value={advancedAi.openAiSiteTitle}
              onChange={(e) => onAdvancedAiPatch({ openAiSiteTitle: e.target.value })}
              className="text-sm"
            />
          </div>
        )}

        {provider === 'ollama' && (
          <div className="space-y-3">
            {!isDesktop && (
              <div className="p-3 rounded-lg bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)] text-sm text-[var(--sc-warning-fg)]">
                <p className="font-semibold mb-1 flex items-center gap-1">
                  <Icon name="warning" size="sm" aria-hidden="true" />
                  {t('settings.ai.corsRestriction')}
                </p>
                <p>{t('settings.ai.ollamaBrowserNote')}</p>
              </div>
            )}
            {isDesktop && (
              <p className="text-xs text-[var(--sc-success-fg)]/90">
                {t('settings.ai.ollamaTauriBypass')}
              </p>
            )}
            <div className="space-y-1">
              <label
                htmlFor="local-backend-preset"
                className="text-sm font-medium text-[var(--sc-text-secondary)] block"
              >
                {t('settings.ai.localBackendPreset')}
              </label>
              <Select
                id="local-backend-preset"
                value={advancedAi.localBackendPreset}
                onChange={(v) => {
                  const preset = v as LocalBackendPreset;
                  const url =
                    preset === 'custom'
                      ? advancedAi.ollamaBaseUrl
                      : LOCAL_BACKEND_PRESET_DEFAULT_URL[preset];
                  onAdvancedAiPatch({ localBackendPreset: preset, ollamaBaseUrl: url });
                }}
                options={presetOptions.map((o) => ({ value: o.id, label: t(o.labelKey) }))}
              />
            </div>
            <label
              htmlFor="ollama-server-url"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.ollamaServerUrl')}
            </label>
            <div className="flex gap-2">
              <Input
                id="ollama-server-url"
                placeholder="http://localhost:11434"
                value={ollamaBaseUrl}
                onChange={(e) =>
                  onAdvancedAiPatch({
                    ollamaBaseUrl: e.target.value,
                    localBackendPreset: 'custom',
                  })
                }
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={handleLoadOllamaModels}
                disabled={isLoadingModels}
                variant="secondary"
              >
                {isLoadingModels ? <Spinner className="w-4 h-4" /> : t('settings.ai.loadModels')}
              </Button>
            </div>
            {isDesktop && (
              <div className="space-y-2">
                <Button
                  type="button"
                  onClick={() => void handleScanLocals()}
                  disabled={scanBusy}
                  variant="secondary"
                  aria-label={t('settings.ai.scanLocalPorts')}
                >
                  {scanBusy ? <Spinner className="w-4 h-4" /> : t('settings.ai.scanLocalPorts')}
                </Button>
                {scanRows.length > 0 && (
                  <ul className="text-xs text-[var(--sc-text-muted)] space-y-1 list-disc pl-4">
                    {scanRows.map((row) => (
                      <li key={row.baseUrl}>
                        {t(row.labelKey)} — {row.baseUrl}{' '}
                        <span
                          className={
                            row.ok ? 'text-[var(--sc-success-fg)]' : 'text-[var(--sc-danger-fg)]'
                          }
                        >
                          {row.ok ? t('settings.ai.scanOk') : t('settings.ai.scanNo')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {ollamaModels.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--sc-text-muted)]">
                  {t('settings.ai.ollamaModelHint')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {ollamaModels.map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => onModelSelect?.(`ollama/${m}`)}
                      className="px-2 py-1 text-xs rounded-full bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-accent)] hover:text-[var(--sc-text-on-accent)] transition-colors"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.ai.ollamaHint')}</p>
          </div>
        )}

        {provider === 'webllm' && (
          <div className="p-3 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] text-sm text-[var(--sc-text-secondary)] space-y-3">
            <p>{t('settings.ai.webllmHint')}</p>

            {/* GPU status badge */}
            <div className="flex items-center gap-2">
              <span className="font-medium">{t('settings.ai.webllm.gpuStatus')}:</span>
              {gpuInfo === null ? (
                <Spinner className="w-3 h-3" />
              ) : (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    gpuInfo.status === 'available'
                      ? 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]'
                      : gpuInfo.status === 'unavailable'
                        ? 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)]'
                        : 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {gpuInfo.status === 'available' && t('settings.ai.webllm.gpuAvailable')}
                  {gpuInfo.status === 'unavailable' && t('settings.ai.webllm.gpuUnavailable')}
                  {gpuInfo.status === 'unknown' && t('settings.ai.webllm.gpuUnknown')}
                </span>
              )}
            </div>

            {/* Adapter info when available */}
            {gpuInfo?.adapterDescription && (
              <p className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.ai.webllm.adapterLabel')}: {gpuInfo.adapterDescription}
                {gpuInfo.vramTier && (
                  <>
                    {' '}
                    · {t('settings.ai.webllm.vramLabel')}: {gpuInfo.vramTier}
                  </>
                )}
              </p>
            )}

            {/* WebLLM model selector */}
            <div className="space-y-1">
              <label
                htmlFor="webllm-model-select"
                className="text-xs font-medium text-[var(--sc-text-muted)] block"
              >
                {t('settings.ai.webllm.modelSelect')}
              </label>
              <Select
                id="webllm-model-select"
                ariaLabel={t('settings.ai.webllm.modelSelectAriaLabel')}
                value=""
                onChange={(v) => onModelSelect?.(v)}
                placeholder={t('settings.ai.webllm.modelSelect')}
                options={WEBLLM_SUPPORTED_MODELS.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>

            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.ai.webllm.fallbackChain')}
            </p>
            <p className="text-xs text-[var(--sc-text-muted)]">
              {t('settings.ai.webllm.tabLeaderNote')}
            </p>
          </div>
        )}

        {provider === 'onnx' && (
          // QNBS-v3: ONNX is now a selectable primary provider — WASM path, no API key needed.
          <div className="p-3 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] text-sm text-[var(--sc-text-secondary)] space-y-3">
            <p>{t('settings.ai.onnx.wasmNote')}</p>
            <div className="space-y-1">
              <label
                htmlFor="onnx-model-select"
                className="text-xs font-medium text-[var(--sc-text-muted)] block"
              >
                {t('settings.ai.onnx.modelSelect')}
              </label>
              <Select
                id="onnx-model-select"
                ariaLabel={t('settings.ai.onnx.modelSelect')}
                value={advancedAi.model}
                onChange={(v) => onModelSelect?.(v)}
                options={ONNX_SUPPORTED_MODELS.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
          </div>
        )}

        {provider === 'transformers' && (
          // QNBS-v3: Transformers.js runs any Xenova-compatible HuggingFace model via WASM/WebGPU.
          <div className="p-3 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] text-sm text-[var(--sc-text-secondary)] space-y-3">
            <p>{t('settings.ai.transformers.hint')}</p>
            <div className="space-y-1">
              <label
                htmlFor="transformers-model-id"
                className="text-xs font-medium text-[var(--sc-text-muted)] block"
              >
                {t('settings.ai.transformers.modelId')}
              </label>
              <input
                id="transformers-model-id"
                type="text"
                className="w-full rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)] px-3 py-2 text-sm text-[var(--sc-text-primary)] font-mono focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                placeholder="Xenova/distilgpt2"
                value={advancedAi.model}
                onChange={(e) => onModelSelect?.(e.target.value)}
              />
              <p className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.ai.transformers.wasmNote')}
              </p>
            </div>
          </div>
        )}

        {provider === 'anthropic' && (
          <div className="p-3 rounded-lg bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)] text-sm text-[var(--sc-warning-fg)]">
            <p className="font-semibold mb-1 flex items-center gap-1">
              <Icon name="warning" size="sm" aria-hidden="true" />
              {t('settings.ai.corsRestriction')}
            </p>
            <p>{t('settings.ai.anthropicCorsNote')}</p>
          </div>
        )}

        {provider !== 'gemini' && (
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleTest} disabled={testStatus === 'loading'} variant="secondary">
              {testStatus === 'loading' ? (
                <Spinner className="w-4 h-4" />
              ) : (
                t('settings.ai.testConnection')
              )}
            </Button>
            {testStatus === 'ok' && (
              <span className="text-sm text-[var(--sc-success-fg)] flex items-center gap-1">
                <Icon name="success" size="sm" aria-hidden="true" />
                {t('settings.ai.connectionSuccess')}
              </span>
            )}
            {testStatus === 'error' && (
              <span className="text-sm text-[var(--sc-danger-fg)] flex items-center gap-1">
                <Icon name="error" size="sm" aria-hidden="true" />
                {testError}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
