/**
 * LoRA Onboarding — First-use explainer shown when enableLoraAdapters is first enabled.
 * QNBS-v3: Privacy-first promise + system requirements checklist.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';
import { checkTrainingEnvironment } from '../../services/lora/loraTrainingService';

interface EnvStatus {
  loaded: boolean;
  pythonAvailable: boolean;
  unslothAvailable: boolean;
  cudaAvailable: boolean;
  vramGb: number;
  message?: string;
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? 'text-green-500' : 'text-[var(--sc-status-error)]'} aria-hidden="true">
        {ok ? '✓' : '✗'}
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
  });

  useEffect(() => {
    checkTrainingEnvironment().then((result) => {
      setEnv({ loaded: true, ...result });
    });
  }, []);

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
      <div className="rounded-sc-md bg-green-50 px-4 py-3">
        <p className="text-sm font-medium text-green-800">{t('lora.onboarding.privacyPromise')}</p>
        <p className="mt-0.5 text-xs text-green-700">{t('lora.onboarding.privacyDetail')}</p>
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
                env.pythonAvailable ? t('lora.onboarding.installed') : t('lora.onboarding.notFound')
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
        {env.message && <p className="text-xs text-[var(--sc-status-error)]">{env.message}</p>}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="self-end rounded-sc-md bg-[var(--sc-interactive-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
      >
        {t('lora.onboarding.getStarted')}
      </button>
    </div>
  );
});
