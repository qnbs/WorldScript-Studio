import React, { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { logger } from '../services/logger';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';
import { useToast } from './ui/Toast';


export const AdvancedImportExport: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectProjectData);
  const toast = useToast();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<'json' | 'markdown' | 'docx'>('json');
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown' | 'docx'>('json');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPasteSection, setShowPasteSection] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      importFormat === 'json' ? '.json' : importFormat === 'markdown' ? '.md,.markdown' : '.docx';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      setIsProcessing(true);
      try {
        if (importFormat === 'docx') {
          await handleDocxImport(file);
        } else {
          const text = await file.text();
          if (importFormat === 'json') {
            const parsed = JSON.parse(text) as {
              title?: string;
              logline?: string;
              manuscript?: Array<{
                id: string;
                title: string;
                content: string;
              }>;
            };
            if (parsed.title) dispatch(projectActions.updateTitle(parsed.title));
            if (parsed.logline) dispatch(projectActions.updateLogline(parsed.logline));
            if (Array.isArray(parsed.manuscript))
              dispatch(projectActions.setManuscript(parsed.manuscript));
          } else {
            // Markdown: split by '# ' headings
            const sections = text
              .split(/\n(?=# )/)
              .filter(Boolean)
              .map((chunk, i) => {
                const firstNewline = chunk.indexOf('\n');
                const rawTitle = firstNewline > 0 ? chunk.slice(0, firstNewline) : chunk;
                const title = rawTitle.replace(/^# /, '').trim() || `Abschnitt ${i + 1}`;
                const content = firstNewline > 0 ? chunk.slice(firstNewline + 1).trim() : '';
                return { id: `import-${Date.now()}-${i}`, title, content };
              });
            if (sections.length > 0) dispatch(projectActions.setManuscript(sections));
          }
        }
        toast.success(t('export.importSuccess'), file.name);
        setIsImportModalOpen(false);
      } catch (error) {
        logger.error('Import failed:', error);
        toast.error(t('export.importFailed'));
      } finally {
        setIsProcessing(false);
      }
    };
    input.click();
  };

  const handleExport = () => {
    if (!project) return;
    const safeName = project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    let content: string;
    let filename: string;
    if (exportFormat === 'json') {
      content = JSON.stringify(
        {
          title: project.title,
          logline: project.logline,
          manuscript: project.manuscript,
        },
        null,
        2
      );
      filename = `${safeName}.json`;
    } else {
      content = project.manuscript.map((s) => `# ${s.title}\n\n${s.content}`).join('\n\n---\n\n');
      filename = `${safeName}.md`;
    }
    const blob = new Blob([content], {
      type: exportFormat === 'json' ? 'application/json' : 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('export.exportSuccess'), project.title);
    setIsExportModalOpen(false);
  };

  const handlePasteImport = () => {
    if (!pasteText.trim() || !project) return;
    const newSection = {
      id: `paste-${Date.now()}`,
      title: pasteTitle.trim() || t('export.pasteSection.defaultTitle'),
      content: pasteText.trim(),
    };
    dispatch(projectActions.setManuscript([...project.manuscript, newSection]));
    toast.success(t('export.importSuccess'), newSection.title);
    setPasteText('');
    setPasteTitle('');
    setShowPasteSection(false);
  };

  const handleCopyForNotion = () => {
    if (!project) return;
    const md = project.manuscript.map((s) => `# ${s.title}\n\n${s.content}`).join('\n\n---\n\n');
    navigator.clipboard.writeText(md);
    toast.success(t('export.pasteSection.copied'));
  };

  const handleDocxImport = async (file: File) => {
    try {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const lines = result.value.split('\n').filter((l) => l.trim());
      const title = lines[0]?.trim() || 'Imported from Word';
      const content = lines.slice(1).join('\n').trim();
      dispatch(projectActions.updateTitle(title));
      dispatch(
        projectActions.setManuscript([{ id: `docx-${Date.now()}`, title: 'Chapter 1', content }])
      );
      toast.success(t('export.importSuccess'), title);
    } catch (error) {
      logger.error('DOCX import failed:', error);
      toast.error(t('export.importFailed'));
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Button onClick={() => setIsImportModalOpen(true)} className="w-full" variant="secondary">
          {t('export.importProject')}
        </Button>
        <Button onClick={() => setIsExportModalOpen(true)} className="w-full" variant="secondary">
          {t('export.exportProject')}
        </Button>
      </div>

      {/* Google Docs / Notion Section */}
      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Google Docs / Notion</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPasteSection(!showPasteSection)}
            >
              {showPasteSection ? `▲ ${t('export.pasteSection.collapse')}` : `▼ ${t('export.pasteSection.expand')}`}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showPasteSection && (
            <div className="space-y-3 mb-3">
              <input
                type="text"
                placeholder={t('export.pasteSection.titlePlaceholder')}
                value={pasteTitle}
                onChange={(e) => setPasteTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--input-background)] text-[var(--foreground)] text-sm"
              />
              <textarea
                placeholder={t('export.pasteSection.textPlaceholder')}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--input-background)] text-[var(--foreground)] text-sm resize-y font-mono"
              />
              <Button onClick={handlePasteImport} disabled={!pasteText.trim()} className="w-full">
                {t('export.pasteSection.importAsChapter')}
              </Button>
            </div>
          )}
          <Button
            variant="secondary"
            onClick={handleCopyForNotion}
            disabled={!project?.manuscript.length}
            className="w-full"
          >
            {t('export.pasteSection.copyAsMarkdown')}
          </Button>
        </CardContent>
      </Card>

      {/* Import Modal */}
      <Modal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        title={t('export.importModalTitle')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2">
              {t('export.importFormat')}
            </label>
            <Select
              value={importFormat}
              onChange={(e) => setImportFormat(e.target.value as 'json' | 'markdown' | 'docx')}
            >
              <option value="json">JSON (.json)</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="docx">{t('export.format.docx')}</option>
            </Select>
          </div>

          <div className="flex justify-end space-x-2">
            <Button variant="secondary" onClick={() => setIsImportModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImport} disabled={isProcessing}>
              {isProcessing ? <Spinner /> : t('export.import')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Export Modal */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        title={t('export.exportModalTitle')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2">
              {t('export.exportFormat')}
            </label>
            <Select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'json' | 'markdown' | 'docx')}
            >
              <option value="json">JSON (.json)</option>
              <option value="markdown">Markdown (.md)</option>
              <option value="docx">{t('export.format.docx')}</option>
            </Select>
          </div>

          <div className="flex justify-end space-x-2">
            <Button variant="secondary" onClick={() => setIsExportModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleExport} disabled={isProcessing}>
              {isProcessing ? <Spinner /> : t('export.export')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
