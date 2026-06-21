import { WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { analyticsPersistenceAllowedNow } from '../../app/analyticsGate';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { selectEnableAdaptiveAiEngine } from '../../features/featureFlags/featureFlagsSlice';
import { selectProjectData } from '../../features/project/projectSelectors';
import { statusActions } from '../../features/status/statusSlice';
import { RECOMMENDED_OLLAMA_MODEL_IDS } from '../../services/ai/modelRecommendations';
import { generateLocalText } from '../../services/localAiFacade';
import { rebuildHybridRagIndex } from '../../services/localRagService';
import type { AIProvider } from '../../types';
import { ApiKeySection } from '../ApiKeySection';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { AdaptiveAiHardwarePanel } from './AdaptiveAiHardwarePanel';
import { AiProviderCard } from './AiProviderCard';
import { GpuMetricsPanel } from './GpuMetricsPanel';
import { LocalAiDownloadProgress } from './LocalAiDownloadProgress';
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
  // QNBS-v3: Issue 10 — gate at the parent level so useAdaptiveAi hook + device profiling
  //          never run when the feature flag is off (saves GPU queries + IDB reads on every settings open)
  const adaptiveAiEnabled = useAppSelector(selectEnableAdaptiveAiEngine);

  const creativityMap: Record<string, number> = { Focused: 0, Balanced: 1, Imaginative: 2 };
  const creativityReverseMap = ['Focused', 'Balanced', 'Imaginative'];

  return (
    <div className="space-y-6">
      {/* QNBS-v3: Download progress modal renders above settings panel (portal-like absolute position). */}
      <LocalAiDownloadProgress />
      <GpuMetricsPanel />
      {/* QNBS-v3: B3 — Adaptive AI hardware panel; conditionally mounted so useAdaptiveAi
          does not trigger device profiling when the feature is disabled */}
      {adaptiveAiEnabled && <AdaptiveAiHardwarePanel />}
      <AiProviderCard
        advancedAi={settings.advancedAi}
        onAdvancedAiPatch={(patch) =>
          handleSettingChange('advancedAi', { ...settings.advancedAi, ...patch })
        }
        onProviderChange={(p) => {
          const currentModel = settings.advancedAi?.model ?? 'gemini-3.5-flash';
          let newModel = currentModel;
          if (p === 'ollama') {
            newModel = currentModel.startsWith('ollama/') ? currentModel : 'ollama/qwen3:8b';
          } else if (p === 'gemini') {
            newModel = currentModel.startsWith('ollama/') ? 'gemini-3.5-flash' : currentModel;
          } else if (p === 'openai') {
            newModel = currentModel.startsWith('gpt-') ? currentModel : 'gpt-4o-mini';
          } else if (p === 'anthropic') {
            newModel = currentModel.startsWith('claude-') ? currentModel : 'claude-haiku-4-5';
          } else if (p === 'webllm') {
            // QNBS-v3: default to first curated MLC model; 'webllm/browser' kept as legacy fallback
            newModel = WEBLLM_SUPPORTED_MODELS[0].id;
          } else if (p === 'onnx') {
            // QNBS-v3: default to SmolLM2-135M — smallest ONNX model, WASM CPU-compatible.
            newModel = 'HuggingFaceTB/SmolLM2-135M-Instruct';
          } else if (p === 'transformers') {
            newModel = 'Xenova/distilgpt2';
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
      {/* QNBS-v3: Hybrid fallback for legacy/thunk path only — Writer orchestration remains the primary provider (see README). */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.hybridFallbackTitle')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
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
                  className="text-sm font-medium text-[var(--sc-text-secondary)]"
                >
                  {t('settings.ai.fallbackStep1')}
                </label>
                <Select
                  id="fb-step-1"
                  value={settings.advancedAi.hybridFallbackChain[0] ?? ''}
                  onChange={(v) => {
                    const primary = settings.advancedAi.provider;
                    const second = settings.advancedAi.hybridFallbackChain[1];
                    const next: AIProvider[] = [];
                    if (v && v !== primary) next.push(v as AIProvider);
                    if (second && second !== primary && second !== v) next.push(second);
                    handleSettingChange('advancedAi', {
                      ...settings.advancedAi,
                      hybridFallbackChain: next,
                    });
                  }}
                  options={[
                    { value: '', label: t('settings.ai.fallbackNone') },
                    ...(['gemini', 'openai', 'ollama', 'grok', 'webllm'] as const)
                      .filter((p) => p !== settings.advancedAi.provider)
                      .map((p) => ({ value: p, label: p })),
                  ]}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="fb-step-2"
                  className="text-sm font-medium text-[var(--sc-text-secondary)]"
                >
                  {t('settings.ai.fallbackStep2')}
                </label>
                <Select
                  id="fb-step-2"
                  value={settings.advancedAi.hybridFallbackChain[1] ?? ''}
                  onChange={(v) => {
                    const primary = settings.advancedAi.provider;
                    const first = settings.advancedAi.hybridFallbackChain[0];
                    const next: AIProvider[] = [];
                    if (first && first !== primary) next.push(first);
                    if (v && v !== primary && v !== first) next.push(v as AIProvider);
                    handleSettingChange('advancedAi', {
                      ...settings.advancedAi,
                      hybridFallbackChain: next,
                    });
                  }}
                  options={[
                    { value: '', label: t('settings.ai.fallbackNone') },
                    ...(['gemini', 'openai', 'ollama', 'grok', 'webllm'] as const)
                      .filter((p) => p !== settings.advancedAi.provider)
                      .map((p) => ({ value: p, label: p })),
                  ]}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="ai-creativity-select"
              className="flex justify-between text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              <span>{t('settings.ai.creativity')}</span>
              <span className="font-bold text-[var(--sc-text-primary)]">
                {settings.aiCreativity}
              </span>
            </label>
            <p className="text-xs text-[var(--sc-text-muted)] mb-2">
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
            <div className="flex justify-between text-xs text-[var(--sc-text-muted)]">
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
  const { t, settings, handleSettingChange } = useSettingsViewContext();
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
      // QNBS-v3: use hybrid rebuilder so semantic embeddings + DuckDB dual-write fire together.
      // SEC: gate the DuckDB mirror on the live analytics opt-out (flag + privacy), re-checked at
      // write time — not on the feature flag alone.
      const chunks = await rebuildHybridRagIndex(
        pid,
        project.manuscript,
        analyticsPersistenceAllowedNow,
      );
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
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.advancedAi.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Model Selection */}
          <div>
            <label
              htmlFor="settings-ai-model"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
            >
              {t('settings.advancedAi.model')}
            </label>
            <p className="text-xs text-[var(--sc-text-muted)] mb-2">
              {t('settings.advancedAi.modelDescription')}
            </p>
            {settings.advancedAi.provider === 'ollama' && (
              <p className="text-xs text-[var(--sc-text-muted)] mb-3">
                {t('settings.advancedAi.modelRecommendationsIntro')}{' '}
                {RECOMMENDED_OLLAMA_MODEL_IDS.join(', ')}
              </p>
            )}
            <Select
              id="settings-ai-model"
              value={showCustomInput ? 'ollama/custom' : currentModel}
              onChange={(v) => {
                if (v === 'ollama/custom') {
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    model: 'ollama/custom',
                  });
                  setCustomModelInput('');
                } else {
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    model: v,
                  });
                }
              }}
              {...(settings.advancedAi.provider === 'anthropic'
                ? {
                    options: [
                      { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
                      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
                      { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
                    ],
                  }
                : settings.advancedAi.provider === 'webllm'
                  ? {
                      options: WEBLLM_SUPPORTED_MODELS.map((m) => ({
                        value: m.id,
                        label: m.label,
                      })),
                    }
                  : {
                      groups:
                        settings.advancedAi.provider === 'ollama'
                          ? [
                              {
                                label: 'Gemma',
                                options: [
                                  { value: 'ollama/gemma3', label: 'Gemma 3 4B' },
                                  { value: 'ollama/gemma3:12b', label: 'Gemma 3 12B' },
                                  { value: 'ollama/gemma3:27b', label: 'Gemma 3 27B' },
                                ],
                              },
                              {
                                label: 'Llama',
                                options: [
                                  { value: 'ollama/llama3.3', label: 'Llama 3.3' },
                                  { value: 'ollama/llama3.2', label: 'Llama 3.2 3B' },
                                  { value: 'ollama/llama4:scout', label: 'Llama 4 Scout 17B' },
                                ],
                              },
                              {
                                label: 'Mistral',
                                options: [
                                  { value: 'ollama/mistral', label: 'Mistral 7B' },
                                  {
                                    value: 'ollama/mistral-small3.2:24b',
                                    label: 'Mistral Small 3.2 24B',
                                  },
                                ],
                              },
                              {
                                label: 'Qwen',
                                options: [
                                  { value: 'ollama/qwen3:8b', label: 'Qwen3 8B' },
                                  { value: 'ollama/qwen3:14b', label: 'Qwen3 14B' },
                                  { value: 'ollama/qwen3:30b-a3b', label: 'Qwen3 30B-A3B (MoE)' },
                                ],
                              },
                              {
                                label: 'DeepSeek',
                                options: [
                                  { value: 'ollama/deepseek-r1:7b', label: 'DeepSeek-R1 7B' },
                                  { value: 'ollama/deepseek-r1:14b', label: 'DeepSeek-R1 14B' },
                                ],
                              },
                              {
                                label: 'Phi',
                                options: [
                                  { value: 'ollama/phi4', label: 'Phi-4 14B' },
                                  { value: 'ollama/phi4-mini:3.8b', label: 'Phi-4 Mini 3.8B' },
                                ],
                              },
                              {
                                label: 'Other',
                                options: [
                                  { value: 'ollama/custom', label: t('settings.ai.customModel') },
                                ],
                              },
                            ]
                          : settings.advancedAi.provider === 'openai'
                            ? [
                                {
                                  label: 'GPT-4.1 (2025)',
                                  options: [
                                    { value: 'gpt-4.1', label: 'GPT-4.1' },
                                    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
                                    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
                                  ],
                                },
                                {
                                  label: 'o-Series Reasoning',
                                  options: [
                                    { value: 'o3', label: 'o3' },
                                    { value: 'o4-mini', label: 'o4-mini' },
                                    { value: 'o3-mini', label: 'o3-mini' },
                                  ],
                                },
                                {
                                  label: 'Legacy',
                                  options: [
                                    { value: 'gpt-4o', label: 'GPT-4o' },
                                    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
                                  ],
                                },
                              ]
                            : [
                                {
                                  label: 'Gemini 3 — Latest',
                                  options: [
                                    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash ✦' },
                                    {
                                      value: 'gemini-3.1-pro-preview',
                                      label: 'Gemini 3.1 Pro Preview',
                                    },
                                    { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' },
                                    {
                                      value: 'gemini-3.1-flash-lite',
                                      label: 'Gemini 3.1 Flash-Lite',
                                    },
                                  ],
                                },
                                {
                                  label: 'Gemini 2.5 — Stable',
                                  options: [
                                    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                                    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
                                  ],
                                },
                                {
                                  label: 'Legacy',
                                  options: [
                                    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
                                    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
                                    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
                                  ],
                                },
                              ],
                    })}
            />

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
                  className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] hover:opacity-90 transition-opacity"
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
                  className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] hover:opacity-90 transition-opacity disabled:opacity-50"
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
                    className="w-full h-2 rounded-full bg-[var(--sc-surface-raised)] overflow-hidden"
                  >
                    <div
                      className="h-full bg-[var(--sc-accent)] transition-all duration-300"
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
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.temperature')} ({settings.advancedAi.temperature})
              </label>
              <p className="text-xs text-[var(--sc-text-muted)] mb-2">
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
              <div className="flex justify-between text-xs text-[var(--sc-text-muted)] mt-1">
                <span>{t('settings.ai.temperature.precise')}</span>
                <span>{t('settings.ai.temperature.balanced')}</span>
                <span>{t('settings.ai.temperature.creative')}</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="settings-ai-max-tokens"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.maxTokens')} ({settings.advancedAi.maxTokens})
              </label>
              <p className="text-xs text-[var(--sc-text-muted)] mb-2">
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
              <div className="flex justify-between text-xs text-[var(--sc-text-muted)] mt-1">
                <span>256</span>
                <span>8 192</span>
                <span>16 384</span>
              </div>
            </div>
            <div>
              <label
                htmlFor="settings-ai-top-p"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.topP')} ({settings.advancedAi.topP})
              </label>
              <p className="text-xs text-[var(--sc-text-muted)] mb-2">
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
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
              >
                {t('settings.advancedAi.rateLimit')} ({settings.advancedAi.rateLimit}/min)
              </label>
              <p className="text-xs text-[var(--sc-text-muted)] mb-2">
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
              <div className="flex justify-between text-xs text-[var(--sc-text-muted)] mt-1">
                <span>10</span>
                <span>60</span>
                <span>120</span>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--sc-border-subtle)] pt-4 space-y-3">
            <h3 className="text-lg font-semibold text-[var(--sc-text-primary)]">
              {t('settings.advancedAi.localRagTitle')}
            </h3>
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('settings.advancedAi.localRagDescription')}
            </p>
            <div>
              <label
                htmlFor="rag-mode-select"
                className="block text-sm font-medium text-[var(--sc-text-primary)] mb-1"
              >
                {t('settings.advancedAi.ragModeLabel')}
              </label>
              <Select
                id="rag-mode-select"
                value={settings.advancedAi.ragMode ?? 'hybrid'}
                onChange={(v) =>
                  handleSettingChange('advancedAi', {
                    ...settings.advancedAi,
                    ragMode: v as 'lexical' | 'hybrid',
                  })
                }
                options={[
                  { value: 'hybrid', label: t('settings.advancedAi.ragModeHybrid') },
                  { value: 'lexical', label: t('settings.advancedAi.ragModeLexical') },
                ]}
              />
              <p className="mt-2 text-xs text-[var(--sc-text-muted)]">
                {t('settings.advancedAi.ragModeHint')}
              </p>
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
};
