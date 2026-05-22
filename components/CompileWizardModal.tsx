import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { useTransientUiStore } from '../app/transientUiStore';
import { useExportViewContext } from '../contexts/ExportViewContext';
import { COMPILE_PRESETS } from '../services/compilePresets';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

export const CompileWizardModal: FC = () => {
  const compileWizardOpen = useTransientUiStore((s) => s.compileWizardOpen);
  const setCompileWizardOpen = useTransientUiStore((s) => s.setCompileWizardOpen);
  const {
    t,
    setFormat,
    setContentToExport,
    setPdfOptions,
    handleDownload,
    isExportLoading,
    project,
  } = useExportViewContext();
  const [step, setStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string>(COMPILE_PRESETS[0]?.id ?? '');

  useEffect(() => {
    if (compileWizardOpen) {
      setStep(0);
      setSelectedId(COMPILE_PRESETS[0]?.id ?? '');
    }
  }, [compileWizardOpen]);

  const preset = COMPILE_PRESETS.find((p) => p.id === selectedId) ?? COMPILE_PRESETS[0];

  const close = () => {
    setCompileWizardOpen(false);
    setStep(0);
  };

  const applyPreset = () => {
    if (!preset) return;
    setFormat(preset.format);
    setContentToExport(preset.contentToExport);
    if (preset.pdfOptions) {
      setPdfOptions((o) => ({ ...o, ...preset.pdfOptions }));
    }
  };

  return (
    <Modal isOpen={compileWizardOpen} onClose={close} title={t('export.compileWizard.title')}>
      <div className="space-y-4">
        {step === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('export.compileWizard.stepPreset')}
            </p>
            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
              {COMPILE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
                    selectedId === p.id
                      ? 'border-[var(--border-interactive)] bg-[var(--sc-accent)]/10'
                      : 'border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]'
                  }`}
                >
                  {t(p.nameKey)}
                </button>
              ))}
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                applyPreset();
                setStep(1);
              }}
            >
              {t('export.compileWizard.next')}
            </Button>
          </div>
        )}
        {step === 1 && preset && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('export.compileWizard.stepReview')}
            </p>
            <ul className="text-sm space-y-1 list-disc pl-5 text-[var(--sc-text-secondary)]">
              <li>
                {t('export.compileWizard.reviewFormat')}: {preset.format.toUpperCase()}
              </li>
              <li>
                {t('export.compileWizard.reviewTitle')}:{' '}
                {preset.contentToExport.title
                  ? t('export.compileWizard.flagOn')
                  : t('export.compileWizard.flagOff')}
              </li>
              <li>
                {t('export.compileWizard.reviewManuscript')}:{' '}
                {preset.contentToExport.manuscript
                  ? t('export.compileWizard.flagOn')
                  : t('export.compileWizard.flagOff')}
              </li>
              <li>
                {t('export.compileWizard.reviewCharsWorlds')}:{' '}
                {preset.contentToExport.characters || preset.contentToExport.worlds
                  ? t('export.compileWizard.flagOn')
                  : t('export.compileWizard.flagOff')}
              </li>
            </ul>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setStep(0)}
              >
                {t('export.compileWizard.back')}
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={isExportLoading || !project?.manuscript.length}
                onClick={async () => {
                  applyPreset();
                  await handleDownload();
                  close();
                }}
              >
                {isExportLoading
                  ? t('export.options.downloadButton')
                  : t('export.compileWizard.runExport')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
