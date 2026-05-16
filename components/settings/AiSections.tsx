import { WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { selectProjectData } from '../../features/project/projectSelectors';
import { statusActions } from '../../features/status/statusSlice';
import { RECOMMENDED_OLLAMA_MODEL_IDS } from '../../services/ai/modelRecommendations';
import { generateLocalText } from '../../services/localAiFacade';
import { rebuildLocalRagIndex } from '../../services/localRagIndex';
import type { AIProvider } from '../../types';
import { ApiKeySection } from '../ApiKeySection';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { AiProviderCard } from './AiProviderCard';
import { ToggleSwitch } from './SettingsShared';

const KNOWN_OLLAMA_MODELS = new Set([
  'ollama/gemma3',
  'ollama/gemma3:12b',
  'ollama/gemma3:27b',
  'ollama/llama3.3',
  'ollama/llama3.2',
  'ollama/llama4:scout',
  'ollama/mistral',
  'ollama/mistral-small3.2:24b',
  'ollama/qwen3:8b',
  'ollama/qwen3:14b',
  'ollama/qwen3:30b-a3b',
  'ollama/deepseek-r1:7b',
  'ollama/deepseek-r1:14b',
  'ollama/phi4',
  'ollama/phi4-mini:3.8b',
]);

const isCustomOllamaModel = (model: string) =>
  model.startsWith('ollama/') && !KNOWN_OLLAMA_MODELS.has(model);

export const AiSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();

  const creativityMap: Record<string, number> = { Focused: 0, Balanced: 1, Imaginative: 2 };
  const creativityReverseMap = ['Focused', 'Balanced', 'Imaginative'];

  return (
    <div className="space-y-6">
      <AiProviderCard
        advancedAi={settings.advancedAi}
        onAdvancedAiPatch={(patch) =>
          handleSettingChange('advancedAi', { ...settings.advancedAi, ...patch })
        }
        onProviderChange={(p) => {
          const currentModel = settings.advancedAi?.model ?? 'gemini-2.5-flash';
          let newModel = currentModel;
          if (p === 'ollama') {
            newModel = currentModel.startsWith('ollama/') ? currentModel : 'ollama/qwen3:8b';
          } else if (p === 'gemini') {
            newModel = currentModel.startsWith('ollama/') ? 'gemini-2.5-flash' : currentModel;
          } else if (p === 'openai') {
            newModel = currentModel.startsWith('gpt-') ? currentModel : 'gpt-4o-mini';
          } else if (p === 'anthropic') {
            newModel = currentModel.startsWith('claude-') ? currentModel : 'claude-haiku-4-5';
          } else if (p === 'webllm') {
            // QNBS-v3: default to first curated MLC model; 'webllm/browser' kept as legacy fallback
            newModel = WEBLLM_SUPPORTED_MODELS[0].id;
          }
          handleSettingChange('advancedAi', {
            ...settings.advancedAi,
            provider: p,
            model: newModel,
          });
        }}
        onModelSelect={(model) =>
          handleSettingChange('advancedAi', {
            ...settings.advancedAi,
            model,
          })
        }
      />
      {/* QNBS-v3: Hybrid-Fallback nur für Legacy-/Thunk-Pfad — Writer-Orchestrierung bleibt Primär-Provider (siehe README). */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--foreground-primary)]">
            {t('settings.ai.hybridFallbackTitle')}
          </h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-1">
            {t('settings.ai.hybridFallbackHint')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleSwitch
            checked={settings.advancedAi.hybridFallbackEnabled}
            onChange={(enabled) =>
              handleSettingChange('advancedAi', {
                ...settings.advancedAi,
                hybridFallbackEnabled: enabled,
              })
            }
            label={t('settings.ai.hybridFallbackToggle')}
          />
          {settings.advancedAi.hybridFallbackEnabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label
                  htmlFor="fb-step-1"
                  className="text-sm font-medium text-[var(--foreground-secondary)]"
                >
                  {t('settings.ai.fallbackStep1')}
                </label>
                <select
                  id="fb-step-1"
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--foreground-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  value={settings.advancedAi.hybridFallbackChain[0] ?? ''}
                  onChange={(e) => {
                    const primary = settings.advancedAi.provider;
                    const v = e.target.value as AIProvider | '';
                    const second = settings.advancedAi.hybridFallbackChain[1];
                    const next: AIProvider[] = [];
                    if (v && v !== primary) next.push(v);
                    if (second && second !== primary && second !== v) next.push(second);
                    handleSettingChange('advancedAi', {
                      ...settings.advancedAi,
                      hybridFallbackChain: next,
                    });
                  }}
                >
                  <option value="">{t('settings.ai.fallbackNone')}</option>
                  {(['gemini', 'openai', 'ollama', 'grok', 'webllm'] as const)
                    .filter((p) => p !== settings.advancedAi.provider)
                    .map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="fb-step-2"
                  className="text-sm font-medium text-[var(--foreground-secondary)]"
                >
                  {t('settings.ai.fallbackStep2')}
                </label>
                <select
                  id="fb-step-2"
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--foreground-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                  value={settings.advancedAi.hybridFallbackChain[1] ?? ''}
                  onChange={(e) => {
                    const primary = settings.advancedAi.provider;
                    const first = settings.advancedAi.hybridFallbackChain[0];
                    const v = e.target.value as AIProvider | '';
                    const next: AIProvider[] = [];
                    if (first && first !== primary) next.push(first);
                    if (v && v !== primary && v !== first) next.push(v);
                    handleSettingChange('advancedAi', {
                      ...settings.advancedAi,
                      hybridFallbackChain: next,
                    });
                  }}
                >
                  <option value="">{t('settings.ai.fallbackNone')}</option>
                  {(['gemini', 'openai', 'ollama', 'grok', 'webllm'] as const)
                    .filter((p) => p !== settings.advancedAi.provider)
                    .map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.ai.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="ai-creativity-select"
              className="flex justify-between text-sm font-medium text-[var(--foreground-secondary)]"
            >
              <span>{t('settings.ai.creativity')}</span>
              <span className="font-bold text-[var(--foreground-primary)]">
                {settings.aiCreativity}
              </span>
            </label>
            <p className="text-xs text-[var(--foreground-muted)] mb-2">
              {t('settings.ai.creativityDescription')}
            </p>
            <input
              id="ai-creativity-select"
              type="range"
              min="0"
              max="2"
              step="1"
              value={creativityMap[settings.aiCreativity]}
              onChange={(e) =>
                handleSettingChange('aiCreativity', creativityReverseMap[Number(e.target.value)])
              }
              className="w-full"
            />
            <div className="flex justify-between text-xs text-[var(--foreground-muted)]">
              <span>{t('settings.creativity.focused')}</span>
              <span>{t('settings.creativity.balanced')}</span>
              <span>{t('settings.creativity.imaginative')}</span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <ApiKeySection />
        </CardContent>
      </Card>
    </div>
  );
};

export const AdvancedAiSection: FC = () => {
  const { t, settings, featureFlags, handleSettingChange } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const [ragBusy, setRagBusy] = useState(false);
  // QNBS-v3: null = idle, 0–1 = downloading; useRef guard prevents setState-on-unmount in callback
  const [webllmProgress, setWebllmProgress] = useState<number | null>(null);
  const webllmMounted = useRef(true);
  useEffect(() => {
    webllmMounted.current = true;
    return () => {
      webllmMounted.current = false;
    };
  }, []);

  const currentModel = settings.advancedAi.model;
  const showCustomInput =
    settings.advancedAi.provider === 'ollama' && isCustomOllamaModel(currentModel);

  const [customModelInput, setCustomModelInput] = useState(
    showCustomInput ? currentModel.replace(/^ollama\//, '') : '',
  );

  const handleWebllmDownload = async () => {
    setWebllmProgress(0);
    try {
      await generateLocalText(
        'ping',
        currentModel === 'webllm/browser' ? WEBLLM_SUPPORTED_MODELS[0].id : currentModel,
        (report) => {
          if (webllmMounted.current) setWebllmProgress(report.progress);
        },
      );
    } finally {
      if (webllmMounted.current) setWebllmProgress(null);
    }
  };

  const applyCustomModel = () => {
    const trimmed = customModelInput.trim();
    if (trimmed) {
      handleSettingChange('advancedAi', {
        ...settings.advancedAi,
        model: `ollama/${trimmed}`,
      });
    }
  };

  const handleBuildLocalRag = async () => {
    const pid = project.id ?? 'browser-project';
    setRagBusy(true);
    try {
      const chunks = await rebuildLocalRagIndex(pid, project.manuscript);
      dispatch(
        statusActions.addNotification({
          type: 'success',
          title: t('settings.advancedAi.localRagDone'),
          description: t('settings.advancedAi.localRagDoneDetail', { count: String(chunks) }),
        }),
      );
    } catch (e: unknown) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('error.apiErrorTitle'),
          description: typeof e === 'string' ? e : e instanceof Error ? e.message : String(e),
        }),
      );
    } finally {
      setRagBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.advancedAi.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Selection */}
          <div>
            <label
              htmlFor="settings-ai-model"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
            >
              {t('settings.advancedAi.model')}
            </label>
            <p className="text-xs text-[var(--foreground-muted)] mb-2">
              {t('settings.advancedAi.modelDescription')}
            </p>
            {settings.advancedAi.provider === 'ollama' && (
              <p className="text-xs text-[var(--foreground-muted)] mb-3">
                {t('settings.advancedAi.modelRecommendationsIntro')}{' '}
                {RECOMMENDED_OLLAMA_MODEL_IDS.join(', ')}
              </p>
            )}
            <Select
              id="settings-ai-model"
              value={showCustomInput ? 'ollama/custom' : currentModel}
              onChange={(e) => {
                if (e.target.value === 'ollama/custom') {
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    model: 'ollama/custom',
                  });
                  setCustomModelInput('');
                } else {
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    model: e.target.value,
                  });
                }
              }}
            >
              {settings.advancedAi.provider === 'ollama' ? (
                <>
                  <optgroup label="Gemma">
                    <option value="ollama/gemma3">Gemma 3 4B</option>
                    <option value="ollama/gemma3:12b">Gemma 3 12B</option>
                    <option value="ollama/gemma3:27b">Gemma 3 27B</option>
                  </optgroup>
                  <optgroup label="Llama">
                    <option value="ollama/llama3.3">Llama 3.3</option>
                    <option value="ollama/llama3.2">Llama 3.2 3B</option>
                    <option value="ollama/llama4:scout">Llama 4 Scout 17B</option>
                  </optgroup>
                  <optgroup label="Mistral">
                    <option value="ollama/mistral">Mistral 7B</option>
                    <option value="ollama/mistral-small3.2:24b">Mistral Small 3.2 24B</option>
                  </optgroup>
                  <optgroup label="Qwen">
                    <option value="ollama/qwen3:8b">Qwen3 8B</option>
                    <option value="ollama/qwen3:14b">Qwen3 14B</option>
                    <option value="ollama/qwen3:30b-a3b">Qwen3 30B-A3B (MoE)</option>
                  </optgroup>
                  <optgroup label="DeepSeek">
                    <option value="ollama/deepseek-r1:7b">DeepSeek-R1 7B</option>
                    <option value="ollama/deepseek-r1:14b">DeepSeek-R1 14B</option>
                  </optgroup>
                  <optgroup label="Phi">
                    <option value="ollama/phi4">Phi-4 14B</option>
                    <option value="ollama/phi4-mini:3.8b">Phi-4 Mini 3.8B</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="ollama/custom">{t('settings.ai.customModel')}</option>
                  </optgroup>
                </>
              ) : settings.advancedAi.provider === 'openai' ? (
                <>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                </>
              ) : settings.advancedAi.provider === 'anthropic' ? (
                <>
                  <option value="claude-opus-4-7">Claude Opus 4.7</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
                  <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                </>
              ) : settings.advancedAi.provider === 'webllm' ? (
                WEBLLM_SUPPORTED_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))
              ) : (
                <>
                  <optgroup label="Current Generation">
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash ✦</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash-Lite</option>
                  </optgroup>
                  <optgroup label="Legacy">
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                    <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                  </optgroup>
                </>
              )}
            </Select>

            {/* Custom Ollama model input */}
            {(showCustomInput || currentModel === 'ollama/custom') && (
              <div className="mt-3 flex gap-2">
                <Input
                  placeholder={t('settings.ai.customModelPlaceholder')}
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyCustomModel();
                  }}
                  className="flex-1 font-mono text-sm"
                  aria-label={t('settings.ai.customModelLabel')}
                />
                <button
                  type="button"
                  onClick={applyCustomModel}
                  className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--background-interactive)] text-white hover:opacity-90 transition-opacity"
                >
                  {t('settings.ai.save')}
                </button>
              </div>
            )}

            {/* WebLLM model download + progress */}
            {settings.advancedAi.provider === 'webllm' && (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => void handleWebllmDownload()}
                  disabled={webllmProgress !== null}
                  className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--background-interactive)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  aria-label={t('settings.ai.webllm.downloading')}
                >
                  {webllmProgress !== null
                    ? t('settings.ai.webllm.downloading')
                    : t('settings.ai.webllm.model')}
                </button>
                {webllmProgress !== null && (
                  <div
                    role="progressbar"
                    aria-label={t('settings.ai.webllm.downloadProgress')}
                    aria-valuenow={Math.round(webllmProgress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="w-full h-2 rounded-full bg-[var(--background-secondary)] overflow-hidden"
                  >
                    <div
                      className="h-full bg-[var(--background-interactive)] transition-all duration-300"
                      style={{ width: `${Math.round(webllmProgress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Parameter sliders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="settings-ai-temperature"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.temperature')} ({settings.advancedAi.temperature})
              </label>
              <p className="text-xs text-[var(--foreground-muted)] mb-2">
                {t('settings.advancedAi.temperatureDescription')}
              </p>
              <input
                id="settings-ai-temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={settings.advancedAi.temperature}
                onChange={(e) =>
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    temperature: parseFloat(e.target.value),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[var(--foreground-muted)] mt-1">
                <span>0 – Precise</span>
                <span>1 – Balanced</span>
                <span>2 – Creative</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="settings-ai-max-tokens"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.maxTokens')} ({settings.advancedAi.maxTokens})
              </label>
              <p className="text-xs text-[var(--foreground-muted)] mb-2">
                {t('settings.advancedAi.maxTokensDescription')}
              </p>
              <input
                id="settings-ai-max-tokens"
                type="range"
                min="256"
                max="16384"
                step="256"
                value={settings.advancedAi.maxTokens}
                onChange={(e) =>
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    maxTokens: parseInt(e.target.value, 10),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[var(--foreground-muted)] mt-1">
                <span>256</span>
                <span>8 192</span>
                <span>16 384</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="settings-ai-top-p"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.topP')} ({settings.advancedAi.topP})
              </label>
              <p className="text-xs text-[var(--foreground-muted)] mb-2">
                {t('settings.advancedAi.topPDescription')}
              </p>
              <input
                id="settings-ai-top-p"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.advancedAi.topP}
                onChange={(e) =>
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    topP: parseFloat(e.target.value),
                  })
                }
                className="w-full"
              />
            </div>
            <div>
              <label
                htmlFor="settings-ai-rate-limit"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.rateLimit')} ({settings.advancedAi.rateLimit}/min)
              </label>
              <p className="text-xs text-[var(--foreground-muted)] mb-2">
                {t('settings.advancedAi.rateLimitDescription')}
              </p>
              <input
                id="settings-ai-rate-limit"
                type="range"
                min="10"
                max="120"
                step="10"
                value={settings.advancedAi.rateLimit}
                onChange={(e) =>
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    rateLimit: parseInt(e.target.value, 10),
                  })
                }
                className="w-full"
              />
              <div className="flex justify-between text-xs text-[var(--foreground-muted)] mt-1">
                <span>10</span>
                <span>60</span>
                <span>120</span>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
            <h3 className="text-lg font-semibold text-[var(--foreground-primary)]">
              {t('settings.advancedAi.localRagTitle')}
            </h3>
            <p className="text-sm text-[var(--foreground-muted)]">
              {t('settings.advancedAi.localRagDescription')}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={ragBusy}
              onClick={() => void handleBuildLocalRag()}
              aria-busy={ragBusy}
            >
              {ragBusy ? <Spinner className="w-4 h-4" /> : t('settings.advancedAi.localRagBuild')}
            </Button>
          </div>

          {/* Feature Flags */}
          <div className="border-t border-[var(--border-primary)] pt-4">
            <h3 className="text-lg font-semibold text-[var(--foreground-primary)] mb-3">
              {t('settings.featureFlags.title')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ToggleSwitch
                label={t('settings.featureFlags.enableOllama')}
                checked={featureFlags.enableOllama}
                onChange={(v) => handleSettingChange('enableOllama', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enablePerformanceBudgets')}
                checked={featureFlags.enablePerformanceBudgets}
                onChange={(v) => handleSettingChange('enablePerformanceBudgets', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableVisualRegression')}
                checked={featureFlags.enableVisualRegression}
                onChange={(v) => handleSettingChange('enableVisualRegression', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableCodexAutoTracking')}
                checked={featureFlags.enableCodexAutoTracking}
                onChange={(v) => handleSettingChange('enableCodexAutoTracking', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableStoryBibleAdvanced')}
                checked={featureFlags.enableStoryBibleAdvanced}
                onChange={(v) => handleSettingChange('enableStoryBibleAdvanced', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableBinderResearch')}
                checked={featureFlags.enableBinderResearch}
                onChange={(v) => handleSettingChange('enableBinderResearch', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableCompileWizard')}
                checked={featureFlags.enableCompileWizard}
                onChange={(v) => handleSettingChange('enableCompileWizard', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableProjectHealthScore')}
                checked={featureFlags.enableProjectHealthScore}
                onChange={(v) => handleSettingChange('enableProjectHealthScore', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableCrossProjectSearch')}
                checked={featureFlags.enableCrossProjectSearch}
                onChange={(v) => handleSettingChange('enableCrossProjectSearch', v)}
              />
              <ToggleSwitch
                label={t('settings.featureFlags.enableAppHealthPanel')}
                checked={featureFlags.enableAppHealthPanel}
                onChange={(v) => handleSettingChange('enableAppHealthPanel', v)}
              />
            </div>
            <p className="text-sm text-[var(--foreground-muted)] mt-3">
              {t('settings.featureFlags.description')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
