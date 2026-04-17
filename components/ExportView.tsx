import type { FC } from 'react';
import React from 'react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';
import { ICONS } from '../constants';
import { useExportView } from '../hooks/useExportView';
import { ExportViewContext, useExportViewContext } from '../contexts/ExportViewContext';
import { useAppSelector } from '../app/hooks';
import { Textarea } from './ui/Textarea';
import { Checkbox } from './ui/Checkbox';
import { AdvancedImportExport } from './AdvancedImportExport';

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
    <div className="border-b border-[var(--border-primary)] last:border-b-0">
      <h3 id={headerId} className="font-semibold text-[var(--foreground-primary)]">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex justify-between items-center p-3 text-left hover:bg-[var(--background-tertiary)]/50 transition-colors"
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
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!isOpen}
        className="p-4 pt-0 animate-in"
      >
        {children}
      </div>
    </div>
  );
});
AccordionSection.displayName = 'AccordionSection';

const ExportControls: FC = () => {
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
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('export.options.title')}
        </h2>
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
              <label className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block">
                {t('export.format.format')}
              </label>
              <Select
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as 'md' | 'txt' | 'pdf' | 'docx' | 'epub')
                }
              >
                <option value="md">{t('export.format.md')}</option>
                <option value="txt">{t('export.format.txt')}</option>
                <option value="pdf">{t('export.format.pdf')}</option>
                <option value="docx">Microsoft Word (.docx)</option>
                <option value="epub">eBook (.epub)</option>
              </Select>
            </div>
            {format === 'pdf' && (
              <div className="space-y-4 border-t border-[var(--border-primary)] pt-4 animate-in">
                <h4 className="font-semibold text-[var(--foreground-secondary)]">
                  {t('export.format.pdfOptions')}
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[var(--foreground-muted)] mb-1 block">
                      {t('export.format.font')}
                    </label>
                    <Select
                      value={pdfOptions.font}
                      onChange={(e) =>
                        setPdfOptions((o) => ({
                          ...o,
                          font: e.target.value as typeof o.font,
                        }))
                      }
                    >
                      <option value="Times">Times New Roman</option>
                      <option value="Courier">Courier</option>
                      <option value="Helvetica">Helvetica/Arial</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--foreground-muted)] mb-1 block">
                      {t('export.format.fontSize')}
                    </label>
                    <Select
                      value={pdfOptions.fontSize}
                      onChange={(e) =>
                        setPdfOptions((o) => ({
                          ...o,
                          fontSize: Number(e.target.value) as typeof o.fontSize,
                        }))
                      }
                    >
                      <option value="12">12 pt</option>
                      <option value="11">11 pt</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[var(--foreground-muted)] mb-1 block">
                    {t('export.format.lineSpacing')}
                  </label>
                  <Select
                    value={pdfOptions.lineSpacing}
                    onChange={(e) =>
                      setPdfOptions((o) => ({
                        ...o,
                        lineSpacing: e.target.value as typeof o.lineSpacing,
                      }))
                    }
                  >
                    <option value="double">{t('export.format.double')}</option>
                    <option value="single">{t('export.format.single')}</option>
                  </Select>
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
        <div className="p-4 space-y-3">
          <Button onClick={handleDownload} className="w-full">
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
            {t('export.options.downloadButton')}
          </Button>
          <Button onClick={handleCopyToClipboard} variant="secondary" className="w-full">
            {copied ? t('export.options.copied') : t('common.copyToClipboard')}
          </Button>
          <Button
            onClick={handleEpubExport}
            variant="secondary"
            className="w-full"
            disabled={epubLoading}
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
          {epubError && <p className="text-red-500 text-sm">{epubError}</p>}
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
        <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
          {t('export.preview.title')}
        </h2>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col min-h-0">
        {formattedOutput ? (
          <pre
            className="bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--border-primary)] p-6 rounded-xl text-[var(--foreground-secondary)] h-full overflow-y-auto whitespace-pre-wrap shadow-inner"
            style={editorStyles}
          >
            {formattedOutput}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--foreground-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-xl bg-[var(--background-secondary)]/30 p-8">
            <div className="p-4 rounded-full bg-[var(--background-tertiary)] mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-12 h-12 text-[var(--foreground-muted)]"
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
  const { project } = useExportViewContext();
  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  return (
    <div className="h-full">
      {/* Advanced Import/Export */}
      <div className="mb-6">
        <AdvancedImportExport />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
        <div className="lg:col-span-1 h-full overflow-y-auto">
          <ExportControls />
        </div>
        <div className="lg:col-span-2 h-full min-h-[500px]">
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
      <ExportViewUI />
    </ExportViewContext.Provider>
  );
};
