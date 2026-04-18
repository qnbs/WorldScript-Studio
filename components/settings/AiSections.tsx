import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import type { AIProvider } from '../../types';
import { ApiKeySection } from '../ApiKeySection';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { AiProviderCard } from './AiProviderCard';
import { ToggleSwitch } from './SettingsShared';

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
          const currentModel = settings.advancedAi?.model ?? 'gemini-1.5-flash';
          const newModel =
            p === 'ollama'
              ? currentModel.startsWith('ollama/')
                ? currentModel
                : 'ollama/gemma3'
              : p === 'gemini'
                ? currentModel.startsWith('ollama/')
                  ? 'gemini-1.5-flash'
                  : currentModel
                : p === 'openai'
                  ? currentModel.startsWith('gpt-')
                    ? currentModel
                    : 'gpt-4o-mini'
                  : p === 'anthropic'
                    ? currentModel.startsWith('claude-')
                      ? currentModel
                      : 'claude-3-haiku'
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
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.advancedAi.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label
              htmlFor="settings-ai-model"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.advancedAi.model')}
            </label>
            <Select
              id="settings-ai-model"
              value={settings.advancedAi.model}
              onChange={(e) =>
                handleSettingChange('advancedAi', {
                  ...settings.advancedAi,
                  model: e.target.value,
                })
              }
            >
              {settings.advancedAi.provider === 'ollama' ? (
                <>
                  <option value="ollama/gemma3">Gemma 3 4B</option>
                  <option value="ollama/llama3">Llama 3</option>
                  <option value="ollama/qwen3-8b">Qwen3 8B</option>
                  <option value="ollama/deepseek-v3.2-7b">DeepSeek V3.2 7B</option>
                  <option value="ollama/llama4-scout-17b">Llama 4 Scout 17B</option>
                  <option value="ollama/mistral">Mistral</option>
                  <option value="ollama/mistral-small-3.2-24b">Mistral Small 3.2 24B</option>
                  <option value="ollama/phi-4-mini-3.8b">Phi-4 Mini 3.8B</option>
                  <option value="ollama/glm-4-9b">GLM-4 9B</option>
                  <option value="ollama/kimi-k2-instruct-32b">Kimi K2 Instruct 32B</option>
                  <option value="ollama/custom">{t('settings.ai.customModel')}</option>
                </>
              ) : settings.advancedAi.provider === 'openai' ? (
                <>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                </>
              ) : settings.advancedAi.provider === 'anthropic' ? (
                <>
                  <option value="claude-3-haiku">Claude 3 Haiku</option>
                  <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                </>
              ) : (
                <>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                </>
              )}
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="settings-ai-temperature"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.advancedAi.temperature')} ({settings.advancedAi.temperature})
              </label>
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
            </div>
            <div>
              <label
                htmlFor="settings-ai-max-tokens"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.advancedAi.maxTokens')} ({settings.advancedAi.maxTokens})
              </label>
              <input
                id="settings-ai-max-tokens"
                type="range"
                min="256"
                max="8192"
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
            </div>
            <div>
              <label
                htmlFor="settings-ai-top-p"
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.advancedAi.topP')} ({settings.advancedAi.topP})
              </label>
              <input
                id="settings-ai-top-p"
                type="range"
                min="0"
                max="1"
                step="0.1"
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
                className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
              >
                {t('settings.advancedAi.rateLimit')} ({settings.advancedAi.rateLimit}/min)
              </label>
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
            </div>
          </div>
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
