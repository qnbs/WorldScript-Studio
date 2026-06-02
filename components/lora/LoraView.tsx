/**
 * LoRA Fine-Tuning View — container that wires the three-file view pattern.
 * QNBS-v3: v1.20 Phase 2.2 — assembles the existing LoRA components (library / dataset /
 *          evaluation / wizard) behind the `LoraViewContext` provider. App.tsx gates the
 *          route on `enableLoraAdapters`; this view defends the gate again for safety.
 */

import type React from 'react';
import { useAppSelector } from '../../app/hooks';
import { LoraViewContext } from '../../contexts/LoraViewContext';
import type { LoraActiveView } from '../../features/lora/types';
import { selectProjectData } from '../../features/project/projectSelectors';
import { useLoraView } from '../../hooks/useLoraView';
import { useTranslation } from '../../hooks/useTranslation';
import LoraAdapterLibrary from './LoraAdapterLibrary';
import LoraDatasetBuilder from './LoraDatasetBuilder';
import LoraEvaluationPanel from './LoraEvaluationPanel';
import LoraOnboarding from './LoraOnboarding';
import LoraTrainingWizard from './LoraTrainingWizard';

// QNBS-v3: sub-nav tabs reuse existing per-section titles — no new i18n keys needed.
const TABS: Array<{ view: LoraActiveView; labelKey: string }> = [
  { view: 'library', labelKey: 'lora.library.title' },
  { view: 'dataset', labelKey: 'lora.dataset.title' },
  { view: 'evaluation', labelKey: 'lora.evaluation.title' },
];

export const LoraView: React.FC = () => {
  const { t } = useTranslation();
  const project = useAppSelector(selectProjectData);
  const lora = useLoraView(project?.id);
  // QNBS-v3: onboarding-seen state lives in loraSlice (persisted) — no component-level localStorage.
  const {
    activeView,
    navigateTo,
    adapters,
    isEnabled,
    error,
    dismissError,
    onboardingDismissed,
    dismissOnboarding,
  } = lora;

  // QNBS-v3: defensive gate — App.tsx already falls back to Dashboard when the flag is off,
  // but rendering a clear message keeps the view self-contained and unit-testable.
  if (!isEnabled) {
    return (
      <div className="py-16 text-center text-sm text-[var(--sc-text-secondary)]">
        {t('settings.loraAdapters.flagGate')}
      </div>
    );
  }

  const inWizard = activeView === 'wizard';
  const showOnboarding = !onboardingDismissed && !inWizard && adapters.length === 0;

  const renderActiveView = () => {
    switch (activeView) {
      case 'wizard':
        return <LoraTrainingWizard />;
      case 'dataset':
        return <LoraDatasetBuilder />;
      case 'evaluation':
        return <LoraEvaluationPanel />;
      default:
        return <LoraAdapterLibrary />;
    }
  };

  return (
    <LoraViewContext.Provider value={lora}>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">{t('lora.title')}</h1>
        </header>

        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-sc-md border border-[var(--sc-danger-border)] bg-[var(--sc-danger-bg)] px-4 py-2 text-sm text-[var(--sc-danger-fg)]"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={dismissError}
              className="shrink-0 rounded-sc-sm px-2 py-1 font-medium hover:bg-[var(--sc-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)]"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {showOnboarding && <LoraOnboarding onDismiss={dismissOnboarding} />}

        {/* Sub-navigation — hidden while the wizard owns the full view. */}
        {!inWizard && (
          <nav
            className="flex gap-1 border-b border-[var(--sc-border-subtle)]"
            aria-label={t('lora.title')}
          >
            {TABS.map(({ view, labelKey }) => {
              const active = activeView === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => navigateTo(view)}
                  aria-current={active ? 'page' : undefined}
                  className={`min-h-[44px] border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] ${
                    active
                      ? 'border-[var(--sc-border-focus)] text-[var(--sc-text-primary)]'
                      : 'border-transparent text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
                  }`}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
        )}

        <div>{renderActiveView()}</div>
      </div>
    </LoraViewContext.Provider>
  );
};

export default LoraView;
