/**
 * LoRA Training Wizard — 5-step guided training flow
 * Steps: model → dataset → params → train → deploy
 * QNBS-v3: Follows existing wizard patterns (CompileWizard, LoraOnboarding).
 */

import React, { useCallback } from 'react';
import { useLoraViewContext } from '../../contexts/LoraViewContext';
import type { LoraWizardStep, PresetId } from '../../features/lora/types';
import { HYPERPARAM_PRESETS } from '../../features/lora/types';
import { useTranslation } from '../../hooks/useTranslation';

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS: LoraWizardStep[] = ['model', 'dataset', 'params', 'train', 'deploy'];

function StepIndicator({ current }: { current: LoraWizardStep }) {
  const { t } = useTranslation();
  const currentIdx = STEPS.indexOf(current);
  return (
    <nav aria-label={t('lora.wizard.steps.label')}>
      <ol className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = step === current;
          return (
            <li key={step} className="flex items-center">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? 'bg-[var(--sc-interactive-primary)] text-white'
                    : done
                      ? 'bg-[var(--sc-success-fg)] text-white'
                      : 'bg-[var(--sc-surface-raised)] text-[var(--sc-text-secondary)]'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className="ml-1.5 hidden text-xs sm:inline text-[var(--sc-text-secondary)]">
                {t(`lora.wizard.steps.${step}`)}
              </span>
              {i < STEPS.length - 1 && (
                <span className="mx-2 h-px w-6 bg-[var(--sc-border-default)]" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step content panels
// ---------------------------------------------------------------------------

function ModelStep() {
  const { selectedBaseModel, selectBaseModel } = useLoraViewContext();
  const { t } = useTranslation();

  const models = [
    { id: 'unsloth/llama-3.2-7b-instruct-bnb-4bit', label: 'Llama 3.2 7B (via Unsloth)' },
    { id: 'unsloth/Phi-3.5-mini-instruct-bnb-4bit', label: 'Phi-3.5 Mini (via Unsloth)' },
    { id: 'unsloth/gemma-2-2b-instruct-bnb-4bit', label: 'Gemma 2 2B (via Unsloth)' },
    { id: 'unsloth/llama-3.2-3b-instruct-bnb-4bit', label: 'Llama 3.2 3B (via Unsloth)' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--sc-text-secondary)]">
        {t('lora.wizard.model.description')}
      </p>
      <fieldset>
        <legend className="sr-only">{t('lora.wizard.model.selectModel')}</legend>
        <div className="space-y-2">
          {models.map((model) => (
            <label
              key={model.id}
              className="flex cursor-pointer items-center gap-3 rounded-sc-md border border-[var(--sc-border-default)] p-3 hover:bg-[var(--sc-surface-raised)]"
            >
              <input
                type="radio"
                name="base-model"
                value={model.id}
                checked={selectedBaseModel === model.id}
                onChange={() => selectBaseModel(model.id)}
                className="accent-[var(--sc-interactive-primary)]"
              />
              <span className="text-sm text-[var(--sc-text-primary)]">{model.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function ParamsStep() {
  const { selectedPresetId, selectPreset } = useLoraViewContext();
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--sc-text-secondary)]">
        {t('lora.wizard.params.description')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {HYPERPARAM_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className={`flex cursor-pointer flex-col gap-1 rounded-sc-lg border p-4 transition-colors ${
              selectedPresetId === preset.id
                ? 'border-[var(--sc-border-focus)] bg-[var(--sc-surface-raised)]'
                : 'border-[var(--sc-border-default)] hover:bg-[var(--sc-surface-raised)]'
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="preset"
                value={preset.id}
                checked={selectedPresetId === preset.id}
                onChange={() => selectPreset(preset.id as PresetId)}
                className="accent-[var(--sc-interactive-primary)]"
              />
              <span className="font-medium text-sm text-[var(--sc-text-primary)]">
                {t(`lora.presets.${preset.labelKey}.label`)}
              </span>
            </div>
            <span className="ml-5 text-xs text-[var(--sc-text-secondary)]">
              {t(`lora.presets.${preset.labelKey}.desc`)}
            </span>
            <span className="ml-5 text-xs text-[var(--sc-text-tertiary)]">
              r={preset.rank} · α={preset.alpha} · {preset.method.toUpperCase()} · ~
              {preset.estimatedMinutes}min · {preset.requiredVramGb}GB VRAM
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function TrainStep() {
  const { isTraining, abortTraining } = useLoraViewContext();
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {isTraining ? (
        <>
          <div
            className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--sc-border-default)] border-t-[var(--sc-interactive-primary)]"
            aria-hidden="true"
          />
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('lora.wizard.training.inProgress')}
          </p>
          <button
            type="button"
            onClick={abortTraining}
            className="rounded-sc-md border border-[var(--sc-status-error)] px-4 py-2 text-sm font-medium text-[var(--sc-status-error)] hover:bg-[var(--sc-status-error)]/10 focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
          >
            {t('lora.wizard.abort')}
          </button>
        </>
      ) : (
        <p className="text-sm text-[var(--sc-text-secondary)]">{t('lora.wizard.training.ready')}</p>
      )}
    </div>
  );
}

function DeployStep() {
  const { activeAdapter } = useLoraViewContext();
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-center">
      <p className="text-4xl" aria-hidden="true">
        🎉
      </p>
      <p className="font-medium text-[var(--sc-text-primary)]">{t('lora.wizard.deploy.title')}</p>
      {activeAdapter ? (
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('lora.wizard.deploy.activated', { name: activeAdapter.name })}
        </p>
      ) : (
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('lora.wizard.deploy.description')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default React.memo(function LoraTrainingWizard() {
  const { wizardStep, goToWizardStep, navigateTo, selectedBaseModel, isTraining } =
    useLoraViewContext();
  const { t } = useTranslation();

  const currentIdx = STEPS.indexOf(wizardStep);

  const canProceed =
    (wizardStep === 'model' && selectedBaseModel.length > 0) ||
    wizardStep === 'dataset' ||
    wizardStep === 'params' ||
    (wizardStep === 'train' && !isTraining) ||
    wizardStep === 'deploy';

  const next = useCallback(() => {
    const nextStep = STEPS[currentIdx + 1];
    if (nextStep) goToWizardStep(nextStep);
  }, [currentIdx, goToWizardStep]);

  const back = useCallback(() => {
    const prevStep = STEPS[currentIdx - 1];
    if (prevStep) goToWizardStep(prevStep);
    else navigateTo('library');
  }, [currentIdx, goToWizardStep, navigateTo]);

  return (
    <section className="flex flex-col gap-6" aria-label={t('lora.wizard.title')}>
      <StepIndicator current={wizardStep} />

      <div className="rounded-sc-lg border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] p-6">
        {wizardStep === 'model' && <ModelStep />}
        {wizardStep === 'dataset' && (
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('lora.wizard.dataset.instruction')}
          </p>
        )}
        {wizardStep === 'params' && <ParamsStep />}
        {wizardStep === 'train' && <TrainStep />}
        {wizardStep === 'deploy' && <DeployStep />}
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={back}
          className="rounded-sc-md border border-[var(--sc-border-default)] px-4 py-2 text-sm font-medium text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-raised)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
        >
          {currentIdx === 0 ? t('common.cancel') : t('common.back')}
        </button>
        {wizardStep !== 'deploy' && (
          <button
            type="button"
            onClick={next}
            disabled={!canProceed || isTraining}
            className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] disabled:opacity-50"
          >
            {t('common.next')}
          </button>
        )}
      </div>
    </section>
  );
});
