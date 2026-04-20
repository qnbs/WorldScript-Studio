import type { FC } from 'react';
import { useState } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import type { AIProvider } from '../../types';
import { ApiKeySection } from '../ApiKeySection';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
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
        provider={(settings.advancedAi?.provider ?? 'gemini') as AIProvider}
        ollamaBaseUrl={settings.advancedAi?.ollamaBaseUrl ?? 'http://localhost:11434'}
        onProviderChange={(p) => {
          const currentModel = settings.advancedAi?.model ?? 'gemini-2.5-flash';
          const newModel =
            p === 'ollama'
              ? currentModel.startsWith('ollama/')
                ? currentModel
                : 'ollama/gemma3'
              : p === 'gemini'
                ? currentModel.startsWith('ollama/')
                  ? 'gemini-2.5-flash'
                  : currentModel
                : p === 'openai'
                  ? currentModel.startsWith('gpt-')
                    ? currentModel
                    : 'gpt-4o-mini'
                  : p === 'anthropic'
                    ? currentModel.startsWith('claude-')
                      ? currentModel
                      : 'claude-haiku-4-5'
                    : currentModel;
          handleSettingChange('advancedAi', {
            ...settings.advancedAi,
            provider: p,
            model: newModel,
          });
        }}
        onOllamaUrlChange={(url) =>
          handleSettingChange('advancedAi', {
            ...settings.advancedAi,
            ollamaBaseUrl: url,
          })
        }
        onModelSelect={(model) =>
          handleSettingChange('advancedAi', {
            ...settings.advancedAi,
            model,
          })
        }
      />
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

  const currentModel = settings.advancedAi.model;
  const showCustomInput =
    settings.advancedAi.provider === 'ollama' && isCustomOllamaModel(currentModel);

  const [customModelInput, setCustomModelInput] = useState(
    showCustomInput ? currentModel.replace(/^ollama\//, '') : '',
  );

  const applyCustomModel = () => {
    const trimmed = customModelInput.trim();
    if (trimmed) {
      handleSettingChange('advancedAi', {
        ...settings.advancedAi,
        model: `ollama/${trimmed}`,
      });
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
