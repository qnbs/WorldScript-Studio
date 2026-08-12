import { ONNX_SUPPORTED_MODELS, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../services/ai/localBackendPresets';
import type { WebGpuAdapterInfo } from '../../services/ai/webGpuDetectorService';
import { detectWebGpuDetails } from '../../services/ai/webGpuDetectorService';
import {
  type LocalEndpointScanResult,
  type LocalServerDiagnostic,
  listLocalBackendModels,
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
} from '../../services/aiProviderService';
import { isServerlessProxyCapable } from '../../services/deployTarget';
import { storageService } from '../../services/storageService';
import { isTauriRuntime } from '../../services/tauriRuntime';
import type { AdvancedAiSettings, AIProvider, LocalBackendPreset } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { AnthropicProviderFields } from './AnthropicProviderFields';

// QNBS-v3: extracted out of AiProviderCard to keep its cognitive complexity under the CI
// threshold — this effect's only job is invalidating stale in-flight tests/model-loads when the
// connection context changes (none of the five values need to be READ, only reacted to).
function useConnectionContextReset(
  testRequestIdRef: React.MutableRefObject<number>,
  setTestStatus: (status: 'idle') => void,
  setTestError: (error: string) => void,
  setIsLoadingModels: (loading: false) => void,
  setOllamaModels: (models: string[]) => void,
  provider: AIProvider,
  ollamaBaseUrl: string,
  localBackendPreset: LocalBackendPreset,
  openAiCompatibleBaseUrl: string,
  browserOllamaEnabled: boolean,
) {
  useEffect(() => {
    void provider;
    void ollamaBaseUrl;
    void localBackendPreset;
    void openAiCompatibleBaseUrl;
    void browserOllamaEnabled;
    testRequestIdRef.current += 1;
    setTestStatus('idle');
    setTestError('');
    // QNBS-v3: without this, a model-load left in flight when the context changes never gets
    // reset (its own stale-check skips setIsLoadingModels(false) too) and the button stays
    // permanently disabled until another load happens to be triggered.
    setIsLoadingModels(false);
    // QNBS-v3: without this, the previous backend's model buttons stay rendered until a new load
    // completes — a user can select a model id that doesn't exist on the newly selected server.
    setOllamaModels([]);
  }, [
    testRequestIdRef,
    setTestStatus,
    setTestError,
    setIsLoadingModels,
    setOllamaModels,
    provider,
    ollamaBaseUrl,
    localBackendPreset,
    openAiCompatibleBaseUrl,
    browserOllamaEnabled,
  ]);
}

// QNBS-v3: converts an inline `if (requestIdRef.current === requestId) apply()` guard into a
// function call — extracted (like the hook above) purely to keep AiProviderCard's own cognitive
// complexity under the CI threshold; each inline guard counted as a branch against it.
function applyIfCurrent(
  requestIdRef: React.MutableRefObject<number>,
  requestId: number,
  apply: () => void,
): void {
  if (requestIdRef.current === requestId) apply();
}

interface AiProviderCardProps {
  advancedAi: AdvancedAiSettings;
  onAdvancedAiPatch: (patch: Partial<AdvancedAiSettings>) => void;
  onProviderChange: (p: AIProvider) => void;
  onModelSelect?: (model: string) => void;
  // QNBS-v3 (ADR-0017): opt-in feature flag — the Ollama section attempts a direct browser fetch
  // instead of requiring desktop when the user has separately configured OLLAMA_ORIGINS. Default
  // false so callers that don't pass it (e.g. older tests) keep today's desktop-only behavior.
  browserOllamaEnabled?: boolean;
}

interface LocalDiagnosticState {
  context: string;
  diagnostic: LocalServerDiagnostic;
}

type ConnectionTestStatus = 'idle' | 'loading' | 'ok' | 'error';

const LocalServerDiagnosticPanel: FC<{ diagnostic: LocalServerDiagnostic }> = ({ diagnostic }) => {
  const { t } = useTranslation();
  const transportLabel =
    diagnostic.transport === 'tauri-http'
      ? t('settings.ai.localDiagnostic.tauriHttp')
      : t('settings.ai.localDiagnostic.browserFetch');

  return (
    <dl
      aria-label={t('settings.ai.localDiagnostic.title')}
      className="mt-3 grid gap-x-3 gap-y-1 text-xs text-[var(--sc-text-secondary)] sm:grid-cols-[auto_1fr]"
    >
      <dt className="font-medium text-[var(--sc-text-primary)]">
        {t('settings.ai.localDiagnostic.endpoint')}
      </dt>
      <dd className="break-all">{diagnostic.normalizedEndpoint}</dd>
      <dt className="font-medium text-[var(--sc-text-primary)]">
        {t('settings.ai.localDiagnostic.transport')}
      </dt>
      <dd>{transportLabel}</dd>
      <dt className="font-medium text-[var(--sc-text-primary)]">
        {t('settings.ai.localDiagnostic.models')}
      </dt>
      <dd>{diagnostic.modelNames.join(', ')}</dd>
    </dl>
  );
};

const ProviderConnectionStatus: FC<{
  diagnostic: LocalServerDiagnostic | null;
  isOllamaUntestable: boolean;
  status: ConnectionTestStatus;
  testError: string;
}> = ({ diagnostic, isOllamaUntestable, status, testError }) => {
  const { t } = useTranslation();
  const statusClass = isOllamaUntestable
    ? 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]'
    : status === 'ok'
      ? 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]'
      : status === 'error'
        ? 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)]'
        : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]';

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--sc-text-secondary)]">
          {t('settings.ai.providerStatusLabel')}
        </span>
        <span
          role="status"
          aria-live="polite"
          aria-busy={!isOllamaUntestable && status === 'loading'}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${statusClass}`}
        >
          {isOllamaUntestable ? (
            t('settings.ai.providerStatusUnavailableBrowser')
          ) : (
            <>
              {status === 'ok' && t('settings.ai.providerStatusConnected')}
              {status === 'error' && t('settings.ai.providerStatusDisconnected')}
              {status === 'idle' && t('settings.ai.providerStatusNotTested')}
            </>
          )}
        </span>
      </div>
      {!isOllamaUntestable && status === 'error' && testError && (
        <p className="text-xs text-[var(--sc-danger-fg)]">{testError}</p>
      )}
      {diagnostic && <LocalServerDiagnosticPanel diagnostic={diagnostic} />}
    </div>
  );
};

function getOllamaAvailability(
  provider: AIProvider,
  isDesktop: boolean,
  browserOllamaEnabled: boolean,
): { canAttemptOllama: boolean; ollamaUntestable: boolean } {
  const canAttemptOllama = isDesktop || browserOllamaEnabled;
  return {
    canAttemptOllama,
    ollamaUntestable: provider === 'ollama' && !canAttemptOllama,
  };
}

export const AiProviderCard: FC<AiProviderCardProps> = ({
  advancedAi,
  onAdvancedAiPatch,
  onProviderChange,
  onModelSelect,
  browserOllamaEnabled = false,
}) => {
  const { t } = useTranslation();
  const provider = advancedAi.provider;
  const ollamaBaseUrl = advancedAi.ollamaBaseUrl;
  // QNBS-v3 (T0): canonical detection (`__TAURI_INTERNALS__`-aware); `__TAURI__` alone read as web
  // in the real desktop shell, hiding desktop-only provider affordances.
  const isDesktop = isTauriRuntime();
  // QNBS-v3 (ADR-0016 Track B): web/PWA Claude support depends on api/claude-proxy existing on the
  // deployment — Vercel/Cloudflare Pages can host it, GitHub Pages (static-only) never can.
  const isAnthropicProxyCapableWeb = !isDesktop && isServerlessProxyCapable();
  // QNBS-v3 (ADR-0017): the opt-in flag widens Ollama testability to the browser — everywhere else
  // in this component that gated Ollama purely on isDesktop now also accepts this flag.
  // QNBS-v3: for Ollama when neither desktop nor the browser opt-in applies, the auto-test effect
  // and the manual "Test connection" button are both disabled (see below) — testStatus can never
  // leave 'idle' here, so the generic status badge must not render its idle→"Ready" label, which
  // would misleadingly imply a verified connection next to the "desktop app required" banner.
  const { canAttemptOllama, ollamaUntestable } = getOllamaAvailability(
    provider,
    isDesktop,
    browserOllamaEnabled,
  );
  const [openaiKey, setOpenaiKey] = useState('');
  // QNBS-v3: Grok's own key input state, mirroring OpenAI's pattern above.
  const [grokKey, setGrokKey] = useState('');
  const [isSavingGrokKey, setIsSavingGrokKey] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [isSavingAnthropicKey, setIsSavingAnthropicKey] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<ConnectionTestStatus>('idle');
  const [testError, setTestError] = useState('');
  const [localDiagnostic, setLocalDiagnostic] = useState<LocalDiagnosticState | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanRows, setScanRows] = useState<LocalEndpointScanResult[]>([]);
  // QNBS-v3: GPU probe runs once when WebLLM tab is selected — no polling. Default 'unknown'
  // (not null) so "never tested" and "tested, inconclusive" render identically without a
  // separate null-check — isProbingGpu below is what distinguishes "actively checking".
  const [gpuInfo, setGpuInfo] = useState<WebGpuAdapterInfo>({ status: 'unknown' });
  // QNBS-v3: without this, the WebGPU badge rendered a permanent spinner until the user clicked
  // Test Connection, since gpuInfo had no other signal for "a probe is currently running".
  const [isProbingGpu, setIsProbingGpu] = useState(false);
  // QNBS-v3 (CodeRabbit CWE-209): monotonic guard against a stale in-flight test result
  // (button click or the auto-test effect) overwriting state after the provider/desktop
  // context has since moved on — e.g. a switch to Ollama-in-browser must not let an older
  // request's raw error text land in testError once ollamaUntestable becomes true.
  const testRequestIdRef = useRef(0);
  const diagnosticContextRef = useRef<string | null>(null);
  const localDiagnosticContext = [
    provider,
    ollamaBaseUrl,
    advancedAi.localBackendPreset,
    advancedAi.openAiCompatibleBaseUrl,
    browserOllamaEnabled ? 'browser-enabled' : 'desktop-only',
    isDesktop ? 'tauri-runtime' : 'browser-runtime',
  ].join('\u0000');
  const visibleLocalDiagnostic =
    localDiagnostic?.context === localDiagnosticContext ? localDiagnostic.diagnostic : null;

  useEffect(() => {
    // QNBS-v3: A completed diagnostic only describes the exact local endpoint context that was tested.
    if (diagnosticContextRef.current === localDiagnosticContext) return;
    diagnosticContextRef.current = localDiagnosticContext;
    testRequestIdRef.current += 1;
    setTestStatus('idle');
    setTestError('');
    setLocalDiagnostic(null);
  }, [localDiagnosticContext]);

  // QNBS-v3: any connection-context change invalidates in-flight tests/model-loads — without this,
  // only an explicit second handleTest() call bumped the guard, so editing the endpoint/preset/URL
  // mid-request let a stale response land under the new context. Also replaces the old
  // key={provider} remount (which discarded unsaved openaiKey/grokKey/anthropicKey input).
  useConnectionContextReset(
    testRequestIdRef,
    setTestStatus,
    setTestError,
    setIsLoadingModels,
    setOllamaModels,
    provider,
    ollamaBaseUrl,
    advancedAi.localBackendPreset,
    advancedAi.openAiCompatibleBaseUrl,
    browserOllamaEnabled,
  );

  // QNBS-v3: shared by the auto-probe effect below and the manual Test Connection click.
  const probeWebGpu = useCallback((requestId: number) => {
    setIsProbingGpu(true);
    void detectWebGpuDetails()
      .then((info) => applyIfCurrent(testRequestIdRef, requestId, () => setGpuInfo(info)))
      .catch(() =>
        applyIfCurrent(testRequestIdRef, requestId, () => setGpuInfo({ status: 'unknown' })),
      )
      .finally(() => applyIfCurrent(testRequestIdRef, requestId, () => setIsProbingGpu(false)));
  }, []);

  // QNBS-v3 regression: restores the auto-probe-on-selection UX lost when an earlier commit removed
  // the combined ollama+webllm auto-test effect — WebGPU detection is a local hardware check, not a
  // network request, so the CORS/privacy rationale for dropping the Ollama auto-test doesn't apply.
  // Runs after useConnectionContextReset's bump above so it always reads the current request id.
  useEffect(() => {
    if (provider === 'webllm') probeWebGpu(testRequestIdRef.current);
  }, [provider, probeWebGpu]);

  useEffect(() => {
    storageService
      .getApiKey('openai')
      .then((k) => setOpenaiKey(k ?? ''))
      .catch(() => {});
    storageService
      .getApiKey('grok')
      .then((k) => setGrokKey(k ?? ''))
      .catch(() => {});
    storageService
      .getApiKey('anthropic')
      .then((k) => setAnthropicKey(k ?? ''))
      .catch(() => {});
  }, []);

  // QNBS-v3: save/clear via storageService, matching every other provider's key persistence.
  const handleSaveGrokKey = useCallback(async () => {
    setIsSavingGrokKey(true);
    try {
      if (grokKey.trim()) {
        await storageService.saveApiKey('grok', grokKey.trim());
      } else {
        await storageService.clearApiKey('grok');
      }
    } finally {
      setIsSavingGrokKey(false);
    }
  }, [grokKey]);

  const handleSaveAnthropicKey = useCallback(async () => {
    setIsSavingAnthropicKey(true);
    try {
      if (anthropicKey.trim()) {
        await storageService.saveApiKey('anthropic', anthropicKey.trim());
      } else {
        await storageService.clearApiKey('anthropic');
      }
    } finally {
      setIsSavingAnthropicKey(false);
    }
  }, [anthropicKey]);

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
    // QNBS-v3 (#266, ADR-0017): never probe localhost from the PWA by default — the request is
    // CORS/PNA-blocked anyway and only produces console noise. Local servers are desktop-only
    // unless the user has explicitly opted into the browser-Ollama flag (and configured their own
    // server's OLLAMA_ORIGINS accordingly).
    if (!isTauriRuntime() && !browserOllamaEnabled) {
      setOllamaModels([]);
      return;
    }
    // QNBS-v3: capture, don't increment — the context-change effect above owns invalidation; this
    // only needs to detect whether ITS OWN in-flight request is still current before applying it.
    const requestId = testRequestIdRef.current;
    setIsLoadingModels(true);
    try {
      const models = await listLocalBackendModels(ollamaBaseUrl, advancedAi.localBackendPreset);
      applyIfCurrent(testRequestIdRef, requestId, () => setOllamaModels(models));
    } catch {
      applyIfCurrent(testRequestIdRef, requestId, () => setOllamaModels([]));
    } finally {
      applyIfCurrent(testRequestIdRef, requestId, () => setIsLoadingModels(false));
    }
  }, [ollamaBaseUrl, advancedAi.localBackendPreset, browserOllamaEnabled]);

  const handleTest = useCallback(async () => {
    const requestId = ++testRequestIdRef.current;
    const requestContext = localDiagnosticContext;
    setTestStatus('loading');
    setTestError('');
    setLocalDiagnostic(null);
    if (provider === 'webllm') probeWebGpu(requestId);
    try {
      const result = await testAIConnection(provider, {
        ollamaBaseUrl,
        localBackendPreset: advancedAi.localBackendPreset,
        openAiCompatibleBaseUrl: advancedAi.openAiCompatibleBaseUrl,
        browserOllamaEnabled,
      });
      if (testRequestIdRef.current !== requestId) return; // stale — superseded by a newer request
      if (result.ok) {
        setTestStatus('ok');
        setLocalDiagnostic(
          result.localServer ? { context: requestContext, diagnostic: result.localServer } : null,
        );
      } else {
        setTestStatus('error');
        // QNBS-v3: `kind` is a stable, i18n-mappable classification — prefer it over the raw
        // `error` string (which is a technical/English message kept for logs) so every failure
        // path across all providers renders localized text, not leaked English.
        setTestError(
          result.kind
            ? t(`settings.ai.testError.${result.kind}`, result.params)
            : (result.error ?? t('settings.ai.connectionFailed')),
        );
      }
    } catch (e) {
      if (testRequestIdRef.current !== requestId) return; // stale — superseded by a newer request
      setTestStatus('error');
      setTestError(e instanceof Error ? e.message : t('settings.ai.unknownError'));
    }
  }, [
    provider,
    ollamaBaseUrl,
    advancedAi.localBackendPreset,
    advancedAi.openAiCompatibleBaseUrl,
    browserOllamaEnabled,
    localDiagnosticContext,
    probeWebGpu,
    t,
  ]);

  const handleScanLocals = useCallback(async () => {
    setScanBusy(true);
    try {
      setScanRows(await scanLocalOpenAiCompatibleEndpoints());
    } finally {
      setScanBusy(false);
    }
  }, []);

  // QNBS-v3 (#266): one-click adopt of a discovered server URL (+ matching preset when known).
  const handleUseScannedUrl = useCallback(
    (baseUrl: string) => {
      const presetEntry = (
        Object.entries(LOCAL_BACKEND_PRESET_DEFAULT_URL) as [LocalBackendPreset, string][]
      ).find(([preset, url]) => preset !== 'custom' && url === baseUrl);
      onAdvancedAiPatch({
        ollamaBaseUrl: baseUrl,
        localBackendPreset: presetEntry ? presetEntry[0] : 'custom',
      });
    },
    [onAdvancedAiPatch],
  );

  const providers: { id: AIProvider; label: string }[] = [
    { id: 'gemini', label: t('settings.ai.provider.gemini') },
    { id: 'openai', label: t('settings.ai.provider.openai') },
    { id: 'ollama', label: t('settings.ai.provider.ollama') },
    { id: 'webllm', label: t('settings.ai.providerWebllm') },
    { id: 'onnx', label: t('settings.ai.providerOnnx') },
    { id: 'transformers', label: t('settings.ai.providerTransformers') },
    { id: 'anthropic', label: t('settings.ai.provider.anthropic') },
    { id: 'grok', label: t('settings.ai.provider.grok') },
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

        <ProviderConnectionStatus
          diagnostic={visibleLocalDiagnostic}
          isOllamaUntestable={ollamaUntestable}
          status={testStatus}
          testError={testError}
        />

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

        {provider === 'grok' && (
          <div className="space-y-3">
            <label
              htmlFor="grok-api-key"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.ai.grokKey')}
            </label>
            <div className="flex gap-2">
              <Input
                id="grok-api-key"
                type="password"
                placeholder="xai-..."
                value={grokKey}
                onChange={(e) => setGrokKey(e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleSaveGrokKey} disabled={isSavingGrokKey} variant="secondary">
                {isSavingGrokKey ? <Spinner className="w-4 h-4" /> : t('settings.ai.save')}
              </Button>
            </div>
            <p className="text-xs text-[var(--sc-text-muted)]">{t('settings.ai.keysEncrypted')}</p>
            <label
              htmlFor="grok-model"
              className="text-sm font-medium text-[var(--sc-text-secondary)] block"
            >
              {t('settings.advancedAi.model')}
            </label>
            <Select
              id="grok-model"
              value={advancedAi.model}
              onChange={(v) => onModelSelect?.(v)}
              options={[
                { value: 'grok-3', label: 'Grok 3' },
                { value: 'grok-3-mini', label: 'Grok 3 Mini' },
              ]}
            />
          </div>
        )}

        {provider === 'ollama' && (
          <div className="space-y-3">
            {!isDesktop && !browserOllamaEnabled && (
              // QNBS-v3 (#266): quiet banner instead of CORS console noise — the PWA never
              // auto-probes localhost, so this is the only place the restriction surfaces.
              <div className="p-3 rounded-lg bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)] text-sm text-[var(--sc-warning-fg)] space-y-2">
                <p className="font-semibold flex items-center gap-1">
                  <Icon name="warning" size="sm" aria-hidden="true" />
                  {t('settings.ai.ollamaDesktopOnlyTitle')}
                </p>
                <p>{t('settings.ai.ollamaDesktopOnlyBody')}</p>
                <a
                  href="https://github.com/qnbs/WorldScript-Studio/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  <Icon name="download" size="sm" aria-hidden="true" />
                  {t('settings.ai.downloadDesktopCta')}
                </a>
              </div>
            )}
            {!isDesktop && browserOllamaEnabled && (
              // QNBS-v3 (ADR-0017): the "technically: yes" opt-in path — direct browser
              // fetch works only if the user's own Ollama server was started with OLLAMA_ORIGINS
              // covering this exact origin. Not a proxy, not a bypass; same real-CORS model
              // NovelCrafter's browser-Ollama support uses. Command is computed from the current
              // origin so it's always correct for this deployment, not a guessed/generic one.
              <div className="p-3 rounded-lg border border-[var(--sc-info-fg)]/30 bg-[var(--sc-info-bg)] text-sm text-[var(--sc-info-fg)] space-y-2">
                <p className="font-semibold flex items-center gap-1">
                  <Icon name="info" size="sm" aria-hidden="true" />
                  {t('settings.ai.ollamaBrowserOptInTitle')}
                </p>
                <p>{t('settings.ai.ollamaBrowserOptInBody')}</p>
                <code className="block rounded bg-[var(--sc-surface-overlay)] px-2 py-1 font-mono text-xs overflow-x-auto text-[var(--sc-text-primary)]">
                  OLLAMA_ORIGINS={window.location.origin} ollama serve
                </code>
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
                // QNBS-v3: editing the URL must not silently reassign the protocol — a native-Ollama
                // user pointing at a non-default host/port (e.g. a LAN server) previously had their
                // preset force-switched to 'custom', which routes every request through the
                // OpenAI-compatible protocol instead of native Ollama and breaks all completions.
                // Protocol selection stays explicit via the preset dropdown above.
                onChange={(e) => onAdvancedAiPatch({ ollamaBaseUrl: e.target.value })}
                className="flex-1 font-mono text-sm"
              />
              <Button
                onClick={handleLoadOllamaModels}
                disabled={isLoadingModels || !canAttemptOllama}
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
                  <ul className="text-xs text-[var(--sc-text-muted)] space-y-1" aria-live="polite">
                    {scanRows.map((row) => (
                      <li key={row.baseUrl} className="flex items-center gap-2 flex-wrap">
                        <span>
                          {t(row.labelKey)} — {row.baseUrl}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
                            row.state === 'ok'
                              ? 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]'
                              : row.state === 'unreachable'
                                ? 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)]'
                                : 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]'
                          }`}
                        >
                          {row.state === 'ok' && t('settings.ai.scanOk')}
                          {row.state === 'unreachable' && t('settings.ai.scanNo')}
                          {row.state === 'timeout' && t('settings.ai.scanStateTimeout')}
                          {row.state === 'http' &&
                            `${t('settings.ai.scanStateHttp')}${row.status ? ` (${row.status})` : ''}`}
                        </span>
                        {row.ok && (
                          <button
                            type="button"
                            onClick={() => handleUseScannedUrl(row.baseUrl)}
                            className="underline underline-offset-2 text-[var(--sc-accent)] hover:opacity-80"
                          >
                            {t('settings.ai.scanUseUrl')}
                          </button>
                        )}
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
              {isProbingGpu ? (
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
            {gpuInfo.adapterDescription && (
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

        {/* QNBS-v3 (ADR-0016): see AnthropicProviderFields.tsx — extracted to keep this
            component's cognitive complexity under the Biome gate. */}
        {provider === 'anthropic' && (
          <AnthropicProviderFields
            isDesktop={isDesktop}
            isProxyCapableWeb={isAnthropicProxyCapableWeb}
            anthropicKey={anthropicKey}
            onAnthropicKeyChange={setAnthropicKey}
            isSavingAnthropicKey={isSavingAnthropicKey}
            onSaveAnthropicKey={handleSaveAnthropicKey}
            model={advancedAi.model}
            onModelSelect={onModelSelect}
          />
        )}

        {provider !== 'gemini' && (
          <div className="flex items-center gap-3 pt-1">
            {/* QNBS-v3 (#266 review, ADR-0017): in the plain PWA the ollama test would re-create
                CORS noise — the banner + CTA above is the only actionable path there. The
                browserOllamaEnabled opt-in widens this the same way it widens the auto-probe. */}
            {/* QNBS-v3: success/error text lives only in ProviderConnectionStatus above — this
                button previously duplicated the exact same testError string in a second span. */}
            <Button
              onClick={handleTest}
              disabled={testStatus === 'loading' || (provider === 'ollama' && !canAttemptOllama)}
              variant="secondary"
            >
              {testStatus === 'loading' ? (
                <Spinner className="w-4 h-4" />
              ) : (
                t('settings.ai.testConnection')
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
