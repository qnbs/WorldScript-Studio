import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { listOllamaModels, testAIConnection } from '../../services/aiProviderService';
import { storageService } from '../../services/storageService';
import type { AIProvider } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Spinner } from '../ui/Spinner';

interface AiProviderCardProps {
  provider: AIProvider;
  ollamaBaseUrl: string;
  onProviderChange: (p: AIProvider) => void;
  onOllamaUrlChange: (url: string) => void;
  onModelSelect?: (model: string) => void;
}

export const AiProviderCard: FC<AiProviderCardProps> = ({
  provider,
  ollamaBaseUrl,
  onProviderChange,
  onOllamaUrlChange,
  onModelSelect,
}) => {
  const { t } = useTranslation();
  const isDesktop = typeof window !== 'undefined' && Boolean(window.__TAURI__);
  const [openaiKey, setOpenaiKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSavingKey, setIsSavingKey] = useState(false);

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
  }, [provider, ollamaBaseUrl, t]);

  useEffect(() => {
    if (provider === 'ollama') {
      void handleLoadOllamaModels();
      void handleTest();
    }
  }, [provider, handleLoadOllamaModels, handleTest]);

  const providers: { id: AIProvider; label: string }[] = [
    { id: 'gemini', label: 'Google Gemini' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'ollama', label: 'Ollama (lokal)' },
    { id: 'anthropic', label: 'Anthropic Claude' },
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                onChange={(e) => onOllamaUrlChange(e.target.value)}
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
