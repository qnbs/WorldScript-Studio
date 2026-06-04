import { ONNX_SUPPORTED_MODELS, WEBLLM_SUPPORTED_MODELS } from '@domain/ai-core';
import type { FC } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import {
  selectEffectiveAiOptions,
  selectProjectAiPreset,
} from '../../features/project/projectSelectors';
import { projectActions } from '../../features/project/projectSlice';
import { statusActions } from '../../features/status/statusSlice';
import type { AIProvider, AiCreativity, AiModel, ProjectAiPreset } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

const MAX_CUSTOM_PROMPT_LENGTH = 2000;

const AI_PROVIDERS: { id: AIProvider; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'grok', label: 'xAI Grok' },
  { id: 'ollama', label: 'Ollama (local)' },
  { id: 'webllm', label: 'WebLLM (browser)' },
  { id: 'onnx', label: 'ONNX (WASM)' },
  { id: 'transformers', label: 'Transformers.js' },
];

const CREATIVITY_OPTIONS: { value: AiCreativity; label: string }[] = [
  { value: 'Focused', label: 'Focused' },
  { value: 'Balanced', label: 'Balanced' },
  { value: 'Imaginative', label: 'Imaginative' },
];

/** Local models that support LoRA adapters (preparatory wiring for v2.0). */
const LORA_CAPABLE_PROVIDERS = new Set<AIProvider>(['webllm', 'onnx', 'transformers']);

export const ProjectAiPresetSection: FC = () => {
  const { t } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const preset = useAppSelector(selectProjectAiPreset);
  const effectiveOptions = useAppSelector(selectEffectiveAiOptions);
  const isEnabled = preset?.enabled === true;

  function patch(changes: Partial<ProjectAiPreset>) {
    dispatch(projectActions.patchProjectAiPreset({ ...preset, enabled: isEnabled, ...changes }));
  }

  function handleToggle(val: boolean) {
    dispatch(projectActions.patchProjectAiPreset({ enabled: val }));
    // QNBS-v3: Inform the user that preset is active so they know it overrides global settings.
    if (val) {
      dispatch(
        statusActions.addNotification({
          type: 'success',
          title: t('settings.projectAi.presetActivatedTitle'),
          description: t('settings.projectAi.presetActivatedDescription'),
        }),
      );
    }
  }

  function handleReset() {
    dispatch(projectActions.clearProjectAiPreset());
  }

  const selectedProvider: AIProvider =
    isEnabled && preset?.provider ? preset.provider : effectiveOptions.provider;
  const showLoraFields = LORA_CAPABLE_PROVIDERS.has(selectedProvider) && isEnabled;

  const modelOptions = (): { value: string; label: string }[] => {
    if (selectedProvider === 'webllm') {
      return WEBLLM_SUPPORTED_MODELS.map((m) => ({ value: m.id, label: m.label }));
    }
    if (selectedProvider === 'onnx') {
      return ONNX_SUPPORTED_MODELS.map((m) => ({ value: m.id, label: m.label }));
    }
    return [];
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
              {t('settings.projectAi.title')}
            </h2>
            <p className="mt-1 text-sm text-[var(--sc-text-muted)]">
              {t('settings.projectAi.description')}
            </p>
          </div>
          {isEnabled && (
            <span className="shrink-0 rounded-full bg-[var(--sc-success-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--sc-success-fg)]">
              {t('settings.projectAi.activeIndicator')}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Enable toggle */}
        <div>
          <ToggleSwitch
            label={t('settings.projectAi.enableToggle')}
            checked={isEnabled}
            onChange={handleToggle}
          />
          <p className="mt-1 text-xs text-[var(--sc-text-muted)]">
            {t('settings.projectAi.enableToggleHint')}
          </p>
        </div>

        {/* Override fields — only shown when enabled */}
        {isEnabled && (
          <>
            {/* Provider */}
            <div className="space-y-1">
              <label
                htmlFor="project-ai-provider"
                className="block text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.projectAi.provider')}
              </label>
              <Select
                id="project-ai-provider"
                value={preset?.provider ?? ''}
                onChange={(e) =>
                  patch({ provider: e.target.value as AIProvider | undefined, model: undefined })
                }
              >
                <option value="">{`— ${t('settings.projectAi.provider')} (global) —`}</option>
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Model — dropdown for local providers, text for others */}
            <div className="space-y-1">
              <label
                htmlFor="project-ai-model"
                className="block text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.projectAi.model')}
              </label>
              {modelOptions().length > 0 ? (
                <Select
                  id="project-ai-model"
                  value={preset?.model ?? ''}
                  onChange={(e) => patch({ model: e.target.value as AiModel })}
                >
                  <option value="">{`— (global) —`}</option>
                  {modelOptions().map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="project-ai-model"
                  type="text"
                  value={preset?.model ?? ''}
                  placeholder={`${effectiveOptions.model} (global)`}
                  onChange={(e) =>
                    patch({ model: (e.target.value || undefined) as AiModel | undefined })
                  }
                />
              )}
            </div>

            {/* Creativity */}
            <div className="space-y-1">
              <label
                htmlFor="project-ai-creativity"
                className="block text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.projectAi.creativity')}
              </label>
              <Select
                id="project-ai-creativity"
                value={preset?.creativity ?? ''}
                onChange={(e) =>
                  patch({ creativity: (e.target.value || undefined) as AiCreativity | undefined })
                }
              >
                <option value="">{`— (global) —`}</option>
                {CREATIVITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Temperature */}
            <div className="space-y-1">
              <label
                htmlFor="project-ai-temp"
                className="block text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.projectAi.temperature')}
                {preset?.temperature !== undefined && (
                  <span className="ml-2 font-mono text-xs text-gray-500">
                    {preset.temperature.toFixed(2)}
                  </span>
                )}
              </label>
              <input
                id="project-ai-temp"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={preset?.temperature ?? effectiveOptions.temperature}
                onChange={(e) => patch({ temperature: Number.parseFloat(e.target.value) })}
                className="w-full accent-[var(--sc-accent)]"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>0 — precise</span>
                <span>2 — creative</span>
              </div>
            </div>

            {/* Max tokens */}
            <div className="space-y-1">
              <label
                htmlFor="project-ai-tokens"
                className="block text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.projectAi.maxTokens')}
              </label>
              <Input
                id="project-ai-tokens"
                type="number"
                min={256}
                max={32768}
                step={256}
                value={preset?.maxTokens ?? effectiveOptions.maxTokens}
                onChange={(e) =>
                  patch({ maxTokens: Number.parseInt(e.target.value, 10) || undefined })
                }
              />
            </div>

            {/* Custom system prompt */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="project-ai-prompt"
                  className="block text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.projectAi.systemPrompt')}
                </label>
                {/* QNBS-v3: Character counter prevents excessively long prompts that bloat the project snapshot. */}
                <span
                  className={`text-xs tabular-nums ${(preset?.customSystemPrompt?.length ?? 0) > MAX_CUSTOM_PROMPT_LENGTH - 100 ? 'text-[var(--sc-warning-fg)]' : 'text-[var(--sc-text-muted)]'}`}
                >
                  {preset?.customSystemPrompt?.length ?? 0}&nbsp;/&nbsp;{MAX_CUSTOM_PROMPT_LENGTH}
                </span>
              </div>
              <textarea
                id="project-ai-prompt"
                rows={4}
                maxLength={MAX_CUSTOM_PROMPT_LENGTH}
                value={preset?.customSystemPrompt ?? ''}
                placeholder={t('settings.projectAi.systemPromptHint')}
                onChange={(e) => patch({ customSystemPrompt: e.target.value || undefined })}
                className="w-full rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] px-3 py-2 text-sm text-[var(--sc-text-primary)] placeholder-[var(--sc-text-muted)] focus-visible:border-[var(--sc-ring-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              />
              <p className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.projectAi.systemPromptHint')}
              </p>
            </div>

            {/* LoRA section — preparatory, only for local inference providers */}
            {showLoraFields && (
              <div className="space-y-4 rounded-sc-md border border-dashed border-amber-500/40 bg-[var(--sc-warning-bg)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-warning-fg)]">
                  {t('settings.projectAi.loraSection')}
                </p>
                <div className="space-y-1">
                  <label
                    htmlFor="project-ai-lora-path"
                    className="block text-sm font-medium text-[var(--sc-text-primary)]"
                  >
                    {t('settings.projectAi.loraModelPath')}
                  </label>
                  <Input
                    id="project-ai-lora-path"
                    type="text"
                    value={preset?.loraModelPath ?? ''}
                    placeholder="e.g. username/my-lora-adapter"
                    onChange={(e) => patch({ loraModelPath: e.target.value || undefined })}
                  />
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {t('settings.projectAi.loraModelPathHint')}
                  </p>
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="project-ai-lora-scale"
                    className="block text-sm font-medium text-[var(--sc-text-primary)]"
                  >
                    {t('settings.projectAi.loraScale')}
                    <span className="ml-2 font-mono text-xs text-gray-500">
                      {(preset?.loraScale ?? 1.0).toFixed(2)}
                    </span>
                  </label>
                  <input
                    id="project-ai-lora-scale"
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={preset?.loraScale ?? 1.0}
                    onChange={(e) => patch({ loraScale: Number.parseFloat(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {t('settings.projectAi.loraScaleHint')}
                  </p>
                </div>
              </div>
            )}

            {/* Reset button */}
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                {t('settings.projectAi.reset')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
