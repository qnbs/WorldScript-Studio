import type { FC } from 'react';
import React from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { ICONS } from '../constants';
import { ExportViewContext, useExportViewContext } from '../contexts/ExportViewContext';
import { selectEnableCompileWizard } from '../features/featureFlags/featureFlagsSlice';
import { projectActions } from '../features/project/projectSlice';
import { useExportView } from '../hooks/useExportView';
import { AdvancedImportExport } from './AdvancedImportExport';
import { CompileWizardModal } from './CompileWizardModal';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Checkbox } from './ui/Checkbox';
import { PageContainer } from './ui/PageContainer';
import { SectionIcon } from './ui/SectionIcon';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';
import { Textarea } from './ui/Textarea';

// --- SUB-COMPONENTS ---

const AccordionSection: FC<{
  title: string;
  children: React.ReactNode;
  idSuffix: string;
}> = React.memo(({ title, children, idSuffix }) => {
  const [isOpen, setIsOpen] = React.useState(true);
  const panelId = `accordion-panel-${idSuffix}`;
  const headerId = `accordion-header-${idSuffix}`;
  return (
    <div className="border-b border-[var(--sc-border-subtle)] last:border-b-0">
      <h3 id={headerId} className="font-semibold text-[var(--sc-text-primary)]">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex justify-between items-center p-3 text-left hover:bg-[var(--sc-surface-overlay)]/50 transition-colors"
          aria-expanded={isOpen}
          aria-controls={panelId}
        >
          {title}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={`w-5 h-5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </h3>
      <section
        id={panelId}
        aria-labelledby={headerId}
        hidden={!isOpen}
        className="p-4 pt-0 animate-in"
      >
        {children}
      </section>
    </div>
  );
});
AccordionSection.displayName = 'AccordionSection';

const ExportControls: FC = () => {
  const dispatch = useAppDispatch();
  const {
    t,
    language,
    project,
    format,
    setFormat,
    contentToExport,
    setContentToExport,
    pdfOptions,
    setPdfOptions,
    aiEnhancements,
    setAiEnhancements,
    isGeneratingSynopsis,
    synopsis,
    setSynopsis,
    generateSynopsis,
    copied,
    handleDownload,
    handleCopyToClipboard,
    isExportLoading,
  } = useExportViewContext();
  const [epubLoading, setEpubLoading] = React.useState(false);
  const [epubError, setEpubError] = React.useState<string | null>(null);

  const handleEpubExport = async () => {
    setEpubError(null);
    setEpubLoading(true);
    try {
      const { exportEpub } = await import('../services/epubApiService');
      const chapters = project.manuscript.map((section) => ({
        title: section.title,
        content: section.content || '',
      }));
      await exportEpub({
        title: project.title,
        author: project.author || '',
        ...(synopsis ? { synopsis } : {}),
        chapters,
        lang: language,
        ...(project.compileProfile ? { compileProfile: project.compileProfile } : {}),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setEpubError(t('export.error.epubFailed') + msg);
    } finally {
      setEpubLoading(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <SectionIcon section="export" size="sm" />
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('export.options.title')}
          </h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        <AccordionSection title={t('export.content.title')} idSuffix="content">
          <div className="space-y-3 pt-4">
            <Checkbox
              id="exp-title"
              label={t('export.content.titleAndLogline')}
              checked={contentToExport.title}
              onChange={(e) => setContentToExport((c) => ({ ...c, title: e.target.checked }))}
            />
            <Checkbox
              id="exp-char"
              label={t('export.content.characters')}
              checked={contentToExport.characters}
              onChange={(e) =>
                setContentToExport((c) => ({
                  ...c,
                  characters: e.target.checked,
                }))
              }
              disabled={project.characters.ids.length === 0}
            />
            <Checkbox
              id="exp-world"
              label={t('export.content.worlds')}
              checked={contentToExport.worlds}
              onChange={(e) => setContentToExport((c) => ({ ...c, worlds: e.target.checked }))}
              disabled={project.worlds.ids.length === 0}
            />
            <Checkbox
              id="exp-manu"
              label={t('export.content.manuscript')}
              checked={contentToExport.manuscript}
              onChange={(e) =>
                setContentToExport((c) => ({
                  ...c,
                  manuscript: e.target.checked,
                }))
              }
              disabled={project.manuscript.length === 0}
            />
          </div>
        </AccordionSection>
        <AccordionSection title={t('export.ai.title')} idSuffix="ai">
          <div className="space-y-3 pt-4">
            <Checkbox
              id="ai-synop"
              label={t('export.ai.synopsis')}
              checked={aiEnhancements.synopsis}
              onChange={(e) => setAiEnhancements((s) => ({ ...s, synopsis: e.target.checked }))}
              disabled={project.manuscript.length === 0}
            />
            {aiEnhancements.synopsis && (
              <div className="space-y-2 pl-7 animate-in">
                <Button
                  size="sm"
                  onClick={generateSynopsis}
                  disabled={isGeneratingSynopsis}
                  className="w-full mb-2"
                >
                  {isGeneratingSynopsis ? (
                    <Spinner className="w-4 h-4 mr-2" />
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-4 h-4 mr-2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM18 13.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 18l-1.035.259a3.375 3.375 0 00-2.456 2.456L18 21.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 18l1.036-.259a3.375 3.375 0 002.456-2.456L18 13.25z"
                      />
                    </svg>
                  )}
                  {t('export.ai.generateButton')}
                </Button>
                <Textarea
                  value={synopsis}
                  onChange={(e) => setSynopsis(e.target.value)}
                  placeholder={t('export.ai.synopsisPlaceholder')}
                  className="min-h-[150px] text-sm"
                />
              </div>
            )}
          </div>
        </AccordionSection>
        <AccordionSection title={t('export.format.title')} idSuffix="format">
          <div className="space-y-4 pt-4">
            <div>
              <label
                htmlFor="export-format"
                className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
              >
                {t('export.format.format')}
              </label>
              <Select
                id="export-format"
                value={format}
                onChange={(v) =>
                  setFormat(v as 'md' | 'txt' | 'pdf' | 'docx' | 'epub' | 'norm-txt')
                }
                options={[
                  { value: 'md', label: t('export.format.md') },
                  { value: 'txt', label: t('export.format.txt') },
                  { value: 'norm-txt', label: t('export.format.normTxt') },
                  { value: 'pdf', label: t('export.format.pdf') },
                  { value: 'docx', label: 'Microsoft Word (.docx)' },
                  { value: 'epub', label: 'eBook (.epub)' },
                ]}
              />
            </div>
            {format === 'pdf' && (
              <div className="space-y-4 border-t border-[var(--sc-border-subtle)] pt-4 animate-in">
                <h4 className="font-semibold text-[var(--sc-text-secondary)]">
                  {t('export.format.pdfOptions')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="export-pdf-font"
                      className="text-xs text-[var(--sc-text-muted)] mb-1 block"
                    >
                      {t('export.format.font')}
                    </label>
                    <Select
                      id="export-pdf-font"
                      value={pdfOptions.font}
                      onChange={(v) =>
                        setPdfOptions((o) => ({
                          ...o,
                          font: v as typeof o.font,
                        }))
                      }
                      options={[
                        { value: 'Times', label: 'Times New Roman' },
                        { value: 'Courier', label: 'Courier' },
                        { value: 'Helvetica', label: 'Helvetica/Arial' },
                      ]}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="export-pdf-font-size"
                      className="text-xs text-[var(--sc-text-muted)] mb-1 block"
                    >
                      {t('export.format.fontSize')}
                    </label>
                    <Select
                      id="export-pdf-font-size"
                      value={String(pdfOptions.fontSize)}
                      onChange={(v) =>
                        setPdfOptions((o) => ({
                          ...o,
                          fontSize: Number(v) as typeof o.fontSize,
                        }))
                      }
                      options={[
                        { value: '12', label: '12 pt' },
                        { value: '11', label: '11 pt' },
                      ]}
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="export-pdf-line-spacing"
                    className="text-xs text-[var(--sc-text-muted)] mb-1 block"
                  >
                    {t('export.format.lineSpacing')}
                  </label>
                  <Select
                    id="export-pdf-line-spacing"
                    value={pdfOptions.lineSpacing}
                    onChange={(v) =>
                      setPdfOptions((o) => ({
                        ...o,
                        lineSpacing: v as typeof o.lineSpacing,
                      }))
                    }
                    options={[
                      { value: 'double', label: t('export.format.double') },
                      { value: 'single', label: t('export.format.single') },
                    ]}
                  />
                </div>
                <Checkbox
                  id="pdf-titlepage"
                  label={t('export.format.titlePage')}
                  checked={pdfOptions.includeTitlePage}
                  onChange={(e) =>
                    setPdfOptions((o) => ({
                      ...o,
                      includeTitlePage: e.target.checked,
                    }))
                  }
                />
              </div>
            )}
          </div>
        </AccordionSection>
        <AccordionSection title={t('export.compileProfile.title')} idSuffix="compile-profile">
          <p className="text-xs text-[var(--sc-text-muted)] pb-2">
            {t('export.compileProfile.hint')}
          </p>
          <div className="space-y-3 pt-2">
            <label htmlFor="cp-title-page" className="sr-only">
              {t('export.compileProfile.titlePage')}
            </label>
            <Textarea
              id="cp-title-page"
              value={project.compileProfile?.titlePageMarkdown ?? ''}
              onChange={(e) =>
                dispatch(projectActions.updateCompileProfile({ titlePageMarkdown: e.target.value }))
              }
              placeholder={t('export.compileProfile.titlePage')}
              className="min-h-[72px] text-sm"
            />
            <label htmlFor="cp-dedication" className="sr-only">
              {t('export.compileProfile.dedication')}
            </label>
            <Textarea
              id="cp-dedication"
              value={project.compileProfile?.dedicationMarkdown ?? ''}
              onChange={(e) =>
                dispatch(
                  projectActions.updateCompileProfile({ dedicationMarkdown: e.target.value }),
                )
              }
              placeholder={t('export.compileProfile.dedication')}
              className="min-h-[56px] text-sm"
            />
            <label htmlFor="cp-imprint" className="sr-only">
              {t('export.compileProfile.imprint')}
            </label>
            <Textarea
              id="cp-imprint"
              value={project.compileProfile?.imprintMarkdown ?? ''}
              onChange={(e) =>
                dispatch(projectActions.updateCompileProfile({ imprintMarkdown: e.target.value }))
              }
              placeholder={t('export.compileProfile.imprint')}
              className="min-h-[56px] text-sm"
            />
            <label htmlFor="cp-ack" className="sr-only">
              {t('export.compileProfile.acknowledgements')}
            </label>
            <Textarea
              id="cp-ack"
              value={project.compileProfile?.acknowledgementsMarkdown ?? ''}
              onChange={(e) =>
                dispatch(
                  projectActions.updateCompileProfile({ acknowledgementsMarkdown: e.target.value }),
                )
              }
              placeholder={t('export.compileProfile.acknowledgements')}
              className="min-h-[56px] text-sm"
            />
          </div>
        </AccordionSection>
        <div className="p-4 space-y-3">
          <Button onClick={handleDownload} className="w-full" disabled={isExportLoading}>
            {isExportLoading ? (
              <Spinner className="w-5 h-5 mr-2" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 mr-2"
              >
                {ICONS.EXPORT}
              </svg>
            )}
            {t('export.options.downloadButton')}
          </Button>
          <Button
            onClick={handleCopyToClipboard}
            variant="secondary"
            className="w-full"
            disabled={isExportLoading}
          >
            {copied ? t('export.options.copied') : t('common.copyToClipboard')}
          </Button>
          <Button
            onClick={handleEpubExport}
            variant="secondary"
            className="w-full"
            disabled={epubLoading || isExportLoading}
          >
            {epubLoading ? (
              <Spinner className="w-4 h-4 mr-2" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 mr-2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 01-6 2.292m0-14.25v14.25"
                />
              </svg>
            )}
            {t('export.epubExport')}
          </Button>
          {epubError && <p className="text-[var(--sc-danger-fg)] text-sm">{epubError}</p>}
        </div>
      </CardContent>
    </Card>
  );
};

const ExportPreview: FC = () => {
  const { t, formattedOutput } = useExportViewContext();
  const settings = useAppSelector((state) => state.settings);

  const fontMap: Record<string, string> = {
    serif: 'serif',
    'sans-serif': 'sans-serif',
    monospace: 'monospace',
  };

  const editorStyles: React.CSSProperties = {
    fontFamily: fontMap[settings.editorFont],
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineSpacing,
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <SectionIcon section="export" size="sm" />
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('export.preview.title')}
          </h2>
        </div>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col min-h-0">
        {/* QNBS-v3: data-testid disambiguates this preview <pre> from ConsistencyChecker/CriticView <pre> elements */}
        {formattedOutput ? (
          <pre
            data-testid="export-preview"
            className="bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--sc-border-subtle)] p-6 rounded-xl text-[var(--sc-text-secondary)] h-full overflow-y-auto whitespace-pre-wrap shadow-inner"
            style={editorStyles}
          >
            {formattedOutput}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--sc-text-muted)] border-2 border-dashed border-[var(--sc-border-subtle)] rounded-xl bg-[var(--sc-surface-raised)]/30 p-8">
            <div className="p-4 rounded-full bg-[var(--sc-surface-overlay)] mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-12 h-12 text-[var(--sc-text-muted)]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <p className="text-lg font-medium">{t('export.preview.noContent')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ExportViewUI: FC = () => {
  const { project, t } = useExportViewContext();
  const enableCompileWizard = useAppSelector(selectEnableCompileWizard);
  const setCompileWizardOpen = useTransientUiStore((s) => s.setCompileWizardOpen);
  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  return (
    <div className="h-full">
      <CompileWizardModal />
      {/* Advanced Import/Export */}
      <div className="mb-4 sm:mb-6">
        <AdvancedImportExport />
      </div>
      {enableCompileWizard ? (
        <div className="mb-4">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => setCompileWizardOpen(true)}
          >
            {t('export.compileWizard.openButton')}
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8 h-full">
        <div className="lg:col-span-1 h-full overflow-y-auto">
          <ExportControls />
        </div>
        {/* QNBS-v3: Preview hidden on mobile (0 min-height) — users export via download button; preview is desktop-only live feedback. */}
        <div className="lg:col-span-2 h-full min-h-0 sm:min-h-[400px] lg:min-h-[500px] hidden sm:block">
          <ExportPreview />
        </div>
      </div>
    </div>
  );
};

export const ExportView: FC = () => {
  const contextValue = useExportView();
  return (
    <ExportViewContext.Provider value={contextValue}>
      <PageContainer>
        <ExportViewUI />
      </PageContainer>
    </ExportViewContext.Provider>
  );
};
