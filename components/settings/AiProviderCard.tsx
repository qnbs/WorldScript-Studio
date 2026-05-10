import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../services/ai/localBackendPresets';
import {
  listOllamaModels,
  scanLocalOpenAiCompatibleEndpoints,
  testAIConnection,
} from '../../services/aiProviderService';
import { storageService } from '../../services/storageService';
import type { AdvancedAiSettings, AIProvider, LocalBackendPreset } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
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
  const isDesktop = typeof window !== 'undefined' && Boolean(window.__TAURI__);
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
    }
  }, [provider, handleLoadOllamaModels, handleTest]);

  const providers: { id: AIProvider; label: string }[] = [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'ollama', label: 'Ollama (lokal)' },
    { id: 'webllm', label: t('settings.ai.providerWebllm') },
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
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('settings.ai.providerTitle')}
        </h2>
        <p className="text-sm text-[var(--foreground-muted)] mt-1">
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
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${provider === p.id ? 'bg-[var(--background-interactive)] border-[var(--background-interactive)] text-white' : 'border-[var(--border-primary)] text-[var(--foreground-secondary)] hover:border-[var(--border-interactive)]'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[var(--foreground-secondary)]">
              {t('settings.ai.providerStatusLabel')}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                testStatus === 'ok'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : testStatus === 'error'
                    ? 'bg-red-500/15 text-red-300'
                    : 'bg-slate-400/10 text-slate-200'
              }`}
            >
              {testStatus === 'ok' && t('settings.ai.providerStatusConnected')}
              {testStatus === 'error' && t('settings.ai.providerStatusDisconnected')}
              {testStatus === 'idle' && t('settings.ai.providerStatusReady')}
            </span>
          </div>
          {testStatus === 'error' && testError && (
            <p className="text-xs text-red-300">{testError}</p>
          )}
        </div>

        {provider === 'gemini' && (
          <div className="p-3 rounded-lg bg-[var(--background-secondary)] text-sm text-[var(--foreground-secondary)]">
            {t('settings.ai.geminiSelected')}
          </div>
        )}

        {provider === 'openai' && (
          <div className="space-y-3">
            <label
              htmlFor="openai-api-key"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
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
            <p className="text-xs text-[var(--foreground-muted)]">
              {t('settings.ai.keysEncrypted')}
            </p>
            {/* QNBS-v3: OpenRouter/Groq nutzen denselben Key-Slot + Root-URL — vermeidet Provider-Enum-Explosion. */}
            <label
              htmlFor="openai-compat-base-url"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
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
            <p className="text-xs text-[var(--foreground-muted)]">
              {t('settings.ai.openAiCompatHint')}
            </p>
            <label
              htmlFor="openai-site-url"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
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
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
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
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
                <p className="font-semibold mb-1">⚠️ {t('settings.ai.corsRestriction')}</p>
                <p>{t('settings.ai.ollamaBrowserNote')}</p>
              </div>
            )}
            {isDesktop && (
              <p className="text-xs text-emerald-400/90">{t('settings.ai.ollamaTauriBypass')}</p>
            )}
            <div className="space-y-1">
              <label
                htmlFor="local-backend-preset"
                className="text-sm font-medium text-[var(--foreground-secondary)] block"
              >
                {t('settings.ai.localBackendPreset')}
              </label>
              <select
                id="local-backend-preset"
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--foreground-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                value={advancedAi.localBackendPreset}
                onChange={(e) => {
                  const preset = e.target.value as LocalBackendPreset;
                  const url =
                    preset === 'custom'
                      ? advancedAi.ollamaBaseUrl
                      : LOCAL_BACKEND_PRESET_DEFAULT_URL[preset];
                  onAdvancedAiPatch({ localBackendPreset: preset, ollamaBaseUrl: url });
                }}
              >
                {presetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <label
              htmlFor="ollama-server-url"
              className="text-sm font-medium text-[var(--foreground-secondary)] block"
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
                  <ul className="text-xs text-[var(--foreground-muted)] space-y-1 list-disc pl-4">
                    {scanRows.map((row) => (
                      <li key={row.baseUrl}>
                        {t(row.labelKey)} — {row.baseUrl}{' '}
                        <span className={row.ok ? 'text-emerald-400' : 'text-red-400'}>
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
                <p className="text-xs text-[var(--foreground-muted)]">
                  {t('settings.ai.ollamaModelHint')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {ollamaModels.map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => onModelSelect?.(`ollama/${m}`)}
                      className="px-2 py-1 text-xs rounded-full bg-[var(--background-tertiary)] text-[var(--foreground-secondary)] hover:bg-[var(--background-interactive)] hover:text-white transition-colors"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">{t('settings.ai.ollamaHint')}</p>
          </div>
        )}

        {provider === 'webllm' && (
          <div className="p-3 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-primary)] text-sm text-[var(--foreground-secondary)] space-y-2">
            <p>{t('settings.ai.webllmHint')}</p>
          </div>
        )}

        {provider === 'anthropic' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-400">
            <p className="font-semibold mb-1">⚠️ {t('settings.ai.corsRestriction')}</p>
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
              <span className="text-sm text-emerald-400">
                ✓ {t('settings.ai.connectionSuccess')}
              </span>
            )}
            {testStatus === 'error' && <span className="text-sm text-red-400">✗ {testError}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
