/**
 * LoRA Onboarding — First-use explainer shown when enableLoraAdapters is first enabled.
 * QNBS-v3: Privacy-first promise + system requirements checklist.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../ui/Icon';

interface EnvStatus {
  loaded: boolean;
  pythonAvailable: boolean;
  unslothAvailable: boolean;
  cudaAvailable: boolean;
  vramGb: number;
  pythonVersion: string;
  pythonPath?: string;
  lastError?: string;
  message?: string;
}

// QNBS-v3: Dynamic import to enable code-splitting — loraTrainingService is also dynamically imported in thunks.
const useLoraTrainingService = () => {
  const [api, setApi] = useState<{
    checkTrainingEnvironment: () => Promise<Omit<EnvStatus, 'loaded'>>;
    selectPythonExecutable: () => Promise<Omit<EnvStatus, 'loaded'> | null>;
  } | null>(null);
  useEffect(() => {
    void import('../../services/lora/loraTrainingService').then((m) => {
      setApi({
        checkTrainingEnvironment: m.checkTrainingEnvironment,
        selectPythonExecutable: m.selectPythonExecutable,
      });
    });
  }, []);
  return api;
};

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={ok ? 'text-[var(--sc-success-fg)]' : 'text-[var(--sc-danger-fg)]'}
        aria-hidden="true"
      >
        <Icon name={ok ? 'check' : 'error'} size="sm" />
      </span>
      <span className="text-[var(--sc-text-primary)]">{label}</span>
      {detail && <span className="text-xs text-[var(--sc-text-secondary)]">({detail})</span>}
    </li>
  );
}

export default React.memo(function LoraOnboarding({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  const [env, setEnv] = useState<EnvStatus>({
    loaded: false,
    pythonAvailable: false,
    unslothAvailable: false,
    cudaAvailable: false,
    vramGb: 0,
    pythonVersion: '',
  });
  const api = useLoraTrainingService();
  const [isSelectingPython, setIsSelectingPython] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.checkTrainingEnvironment().then((result) => {
      setEnv({ loaded: true, ...result });
    });
  }, [api]);

  const handleSelectPython = async () => {
    if (!api) return;
    setIsSelectingPython(true);
    try {
      const result = await api.selectPythonExecutable();
      if (result) setEnv({ loaded: true, ...result });
    } catch (error) {
      // QNBS-v3: Keep the failed manual selection visible instead of falsely reporting Python as absent.
      setEnv((current) => ({
        ...current,
        loaded: true,
        lastError: error instanceof Error ? error.message : 'python_selection_failed',
      }));
    } finally {
      setIsSelectingPython(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 rounded-sc-xl border border-[var(--sc-border-default)] bg-[var(--sc-surface-base)] p-6 shadow-sm">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
          {t('lora.onboarding.title')}
        </h2>
        <p className="text-sm text-[var(--sc-text-secondary)]">
          {t('lora.onboarding.description')}
        </p>
      </div>

      {/* Privacy promise */}
      <div className="rounded-sc-md bg-[var(--sc-success-bg)] px-4 py-3">
        <p className="text-sm font-medium text-[var(--sc-success-fg)]">
          {t('lora.onboarding.privacyPromise')}
        </p>
        <p className="mt-0.5 text-xs text-[var(--sc-success-fg)]/80">
          {t('lora.onboarding.privacyDetail')}
        </p>
      </div>

      {/* System requirements */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-[var(--sc-text-primary)]">
          {t('lora.onboarding.systemCheck')}
        </h3>
        {!env.loaded ? (
          <p className="text-sm text-[var(--sc-text-secondary)]">{t('lora.onboarding.checking')}</p>
        ) : (
          <ul className="space-y-2">
            <StatusRow
              label="Python 3.10+"
              ok={env.pythonAvailable}
              detail={
                env.pythonAvailable
                  ? [env.pythonVersion, env.pythonPath].filter(Boolean).join(' · ')
                  : (env.lastError ?? t('lora.onboarding.notFound'))
              }
            />
            <StatusRow
              label="Unsloth + PEFT"
              ok={env.unslothAvailable}
              detail={
                env.unslothAvailable
                  ? t('lora.onboarding.installed')
                  : t('lora.onboarding.installCmd')
              }
            />
            <StatusRow
              label="GPU (CUDA / MPS)"
              ok={env.cudaAvailable}
              detail={env.vramGb > 0 ? `${env.vramGb} GB VRAM` : t('lora.onboarding.cpuFallback')}
            />
          </ul>
        )}
        {env.message && (
          <p className="text-xs text-[var(--sc-danger-fg)]">{t('lora.onboarding.envError')}</p>
        )}
        <button
          type="button"
          onClick={() => void handleSelectPython()}
          disabled={!api || isSelectingPython}
          className="text-sm text-[var(--sc-interactive-primary)] underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
        >
          {isSelectingPython ? t('lora.onboarding.checking') : t('lora.onboarding.selectPython')}
        </button>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="self-end rounded-sc-md bg-[var(--sc-interactive-primary)] px-5 py-2 text-sm font-medium text-[var(--sc-text-on-accent)] hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
      >
        {t('lora.onboarding.getStarted')}
      </button>
    </div>
  );
});
