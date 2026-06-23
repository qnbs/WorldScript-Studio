import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import { generateSynopsisThunk } from '../features/project/thunks/writingThunks';
import { statusActions } from '../features/status/statusSlice';
import { useTranslation } from './useTranslation';

type Format = 'md' | 'txt' | 'pdf' | 'docx' | 'epub' | 'norm-txt';
// QNBS-v3: gate the Book Preview → Export hand-off so only valid formats can preselect the dropdown.
const VALID_FORMATS: readonly Format[] = ['md', 'txt', 'pdf', 'docx', 'epub', 'norm-txt'];
// QNBS-v3 (CodeAnt): runtime type guard instead of an `as Format` assertion on store-supplied input.
function isFormat(value: string | null): value is Format {
  return value !== null && (VALID_FORMATS as readonly string[]).includes(value);
}
interface ContentToExport {
  title: boolean;
  characters: boolean;
  worlds: boolean;
  manuscript: boolean;
}
interface PdfOptions {
  font: 'Times' | 'Courier' | 'Helvetica';
  fontSize: 11 | 12;
  lineSpacing: 'single' | 'double';
  includeTitlePage: boolean;
}
interface AiEnhancements {
  synopsis: boolean;
}

export const useExportView = () => {
  const { t, language } = useTranslation();
  const dispatch = useAppDispatch();
  const projectState = useAppSelector((state) => state.project.present);
  const project = projectState.data;
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);

  const [format, setFormat] = useState<Format>('md');
  // QNBS-v3: consume a one-shot preselected format from the Book Preview "Export" hand-off, then clear it.
  const exportInitialFormat = useTransientUiStore((s) => s.exportInitialFormat);
  const setExportInitialFormat = useTransientUiStore((s) => s.setExportInitialFormat);
  useEffect(() => {
    if (isFormat(exportInitialFormat)) {
      setFormat(exportInitialFormat);
      setExportInitialFormat(null);
    }
  }, [exportInitialFormat, setExportInitialFormat]);

  const [contentToExport, setContentToExport] = useState<ContentToExport>({
    title: true,
    characters: true,
    worlds: true,
    manuscript: true,
  });
  const [pdfOptions, setPdfOptions] = useState<PdfOptions>({
    font: 'Times',
    fontSize: 12,
    lineSpacing: 'double',
    includeTitlePage: true,
  });
  const [aiEnhancements, setAiEnhancements] = useState<AiEnhancements>({ synopsis: false });
  const [isGeneratingSynopsis, setIsGeneratingSynopsis] = useState(false);
  const [synopsis, setSynopsis] = useState('');
  const [copied, setCopied] = useState(false);
  const [isExportLoading, setIsExportLoading] = useState(false);

  const generateSynopsis = useCallback(async () => {
    setIsGeneratingSynopsis(true);
    const resultAction = await dispatch(generateSynopsisThunk(language));
    if (generateSynopsisThunk.fulfilled.match(resultAction)) {
      setSynopsis(resultAction.payload);
    }
    setIsGeneratingSynopsis(false);
  }, [dispatch, language]);

  const compilePrefix = useMemo(() => {
    const cp = project.compileProfile;
    if (!cp) return '';
    const chunks: string[] = [];
    if (cp.titlePageMarkdown?.trim()) chunks.push(cp.titlePageMarkdown.trim());
    if (cp.dedicationMarkdown?.trim()) chunks.push(cp.dedicationMarkdown.trim());
    if (cp.imprintMarkdown?.trim()) chunks.push(cp.imprintMarkdown.trim());
    for (const b of cp.frontMatter ?? []) {
      chunks.push(`## ${b.title}\n\n${b.bodyMarkdown}`);
    }
    return chunks.length ? `${chunks.join('\n\n')}\n\n` : '';
  }, [project.compileProfile]);

  const compileSuffix = useMemo(() => {
    const cp = project.compileProfile;
    if (!cp) return '';
    const chunks: string[] = [];
    if (cp.acknowledgementsMarkdown?.trim()) chunks.push(cp.acknowledgementsMarkdown.trim());
    for (const b of cp.backMatter ?? []) {
      chunks.push(`## ${b.title}\n\n${b.bodyMarkdown}`);
    }
    return chunks.length ? `\n\n${chunks.join('\n\n')}` : '';
  }, [project.compileProfile]);

  const formattedOutput = useMemo(() => {
    let output = compilePrefix;
    if (contentToExport.title) {
      output += `# ${project.title}\n\n**${t('export.loglineLabel')}:** ${project.logline}\n\n`;
    }
    if (aiEnhancements.synopsis && synopsis) {
      output += `## ${t('export.ai.synopsisTitle')}\n\n${synopsis}\n\n`;
    }
    if (contentToExport.characters && characters.length > 0) {
      output += `## ${t('export.charactersLabel')}\n\n`;
      characters.forEach((char) => {
        output += `### ${char.name}\n- **${t('export.appearanceLabel')}:** ${char.appearance}\n- **${t('export.motivationLabel')}:** ${char.motivation}\n- **${t('export.backstoryLabel')}:** ${char.backstory}\n- **${t('export.notesLabel')}:** ${char.notes}\n\n`;
      });
    }
    if (contentToExport.worlds && worlds.length > 0) {
      output += `## ${t('export.worldsLabel')}\n\n`;
      worlds.forEach((world) => {
        output += `### ${world.name}\n- **${t('export.descriptionLabel')}:** ${world.description}\n- **${t('export.geographyLabel')}:** ${world.geography}\n- **${t('export.magicSystemLabel')}:** ${world.magicSystem}\n\n`;
      });
    }
    if (contentToExport.manuscript && project.manuscript.length > 0) {
      output += `## ${t('export.manuscriptLabel')}\n\n`;
      project.manuscript.forEach((section) => {
        output += `### ${section.title}\n\n${section.content || `*(${t('export.emptySection')})*`}\n\n`;
      });
    }
    const trimmed = output.trim();
    return `${trimmed}${compileSuffix}`.trim();
  }, [
    project,
    characters,
    worlds,
    contentToExport,
    aiEnhancements,
    synopsis,
    t,
    compilePrefix,
    compileSuffix,
  ]);

  const downloadPdf = useCallback(async () => {
    setIsExportLoading(true);
    try {
      const jspdfModule = await import('jspdf');
      const jspdf = jspdfModule.default || jspdfModule;
      const doc = new jspdf();
      const margin = 20;
      const pageHeight = doc.internal.pageSize.getHeight();
      let y = margin;

      doc.setFont(pdfOptions.font, 'normal');
      doc.setFontSize(pdfOptions.fontSize);
      const lineSpacingFactor = pdfOptions.lineSpacing === 'double' ? 10 : 5;

      const addText = (
        text: string,
        options: { size?: number; style?: string; isHeader?: boolean } = {},
      ) => {
        doc.setFontSize(options.size || pdfOptions.fontSize);
        doc.setFont(pdfOptions.font, options.style || 'normal');

        const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - margin * 2);
        lines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += lineSpacingFactor;
        });
        if (options.isHeader) y += lineSpacingFactor / 2;
      };

      // Title Page
      if (pdfOptions.includeTitlePage) {
        doc.setFontSize(24);
        doc.text(project.title, doc.internal.pageSize.getWidth() / 2, pageHeight / 2 - 10, {
          align: 'center',
        });
        doc.setFontSize(14);
        doc.text(
          `Logline: ${project.logline}`,
          doc.internal.pageSize.getWidth() / 2,
          pageHeight / 2,
          { align: 'center' },
        );
        doc.addPage();
        y = margin;
      }

      // Main content
      if (aiEnhancements.synopsis && synopsis) {
        addText(t('export.ai.synopsisTitle'), { size: 18, style: 'bold', isHeader: true });
        addText(synopsis);
        y += lineSpacingFactor;
      }

      if (contentToExport.manuscript) {
        project.manuscript.forEach((section) => {
          addText(section.title, { size: 16, style: 'bold', isHeader: true });
          addText(section.content || `(${t('export.emptySection')})`);
          y += lineSpacingFactor;
        });
      }

      doc.save(`${project.title}.pdf`);
    } catch (error) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('export.error.exportFailed'),
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsExportLoading(false);
    }
  }, [pdfOptions, project, synopsis, t, aiEnhancements, contentToExport, dispatch]);

  const downloadDocx = useCallback(async () => {
    setIsExportLoading(true);
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
      const children = [];

      // Title
      children.push(
        new Paragraph({
          text: project.title,
          heading: HeadingLevel.TITLE,
        }),
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Logline: ${project.logline}`, italics: true })],
        }),
      );

      if (aiEnhancements.synopsis && synopsis) {
        children.push(
          new Paragraph({ text: t('export.ai.synopsisTitle'), heading: HeadingLevel.HEADING_1 }),
        );
        children.push(new Paragraph({ text: synopsis }));
      }

      if (contentToExport.manuscript) {
        children.push(
          new Paragraph({ text: t('export.manuscriptLabel'), heading: HeadingLevel.HEADING_1 }),
        );
        project.manuscript.forEach((section) => {
          children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));
          const paragraphs = (section.content || '').split('\n');
          paragraphs.forEach((p) => {
            if (p.trim()) children.push(new Paragraph({ text: p }));
          });
        });
      }

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: children,
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('export.error.exportFailed'),
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsExportLoading(false);
    }
  }, [project, synopsis, aiEnhancements, contentToExport, t, dispatch]);

  const downloadEpub = useCallback(async () => {
    setIsExportLoading(true);
    try {
      const { buildPandocMarkdownFromProject } = await import('../services/pandocExportMarkdown');
      const { tryPandocMarkdownToEpub } = await import('../services/pandocTauri');
      const pandocMd = buildPandocMarkdownFromProject(project);
      const pandocBytes = await tryPandocMarkdownToEpub(pandocMd);
      if (pandocBytes && pandocBytes.byteLength > 0) {
        const blob = new Blob([new Uint8Array(pandocBytes)], { type: 'application/epub+zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.title.replace(/[/\\?%*:|"<>]/g, '-')}.epub`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const { exportEpub } = await import('../services/epubApiService');
      const chapters = contentToExport.manuscript
        ? project.manuscript.map((section) => ({
            title: section.title,
            content: section.content || '',
          }))
        : [];
      await exportEpub({
        title: project.title,
        author: project.author ?? '',
        lang: language,
        chapters,
        ...(aiEnhancements.synopsis && synopsis.trim() ? { synopsis } : {}),
        ...(project.compileProfile ? { compileProfile: project.compileProfile } : {}),
      });
    } catch (error) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('export.error.exportFailed'),
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setIsExportLoading(false);
    }
  }, [
    project,
    contentToExport.manuscript,
    synopsis,
    aiEnhancements.synopsis,
    language,
    dispatch,
    t,
  ]);

  const handleDownload = useCallback(async () => {
    try {
      if (format === 'pdf') {
        await downloadPdf();
      } else if (format === 'docx') {
        await downloadDocx();
      } else if (format === 'epub') {
        await downloadEpub();
      } else if (format === 'norm-txt') {
        const { buildNormManuscriptExport } = await import('../services/normPageExport');
        const textOutput = buildNormManuscriptExport(
          project.manuscript.map((s) => ({
            title: s.title,
            content: s.content ?? '',
          })),
        );
        const blob = new Blob([textOutput], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.title}-norm.txt`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const extension = format === 'md' ? 'md' : 'txt';
        let textOutput = formattedOutput;
        if (format === 'txt') {
          textOutput = textOutput.replace(/#+\s/g, '').replace(/\*\*(.*?)\*\*/g, '$1');
        }
        const blob = new Blob([textOutput], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.title}.${extension}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('export.error.exportFailed'),
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }, [
    format,
    formattedOutput,
    project.title,
    project.manuscript,
    downloadPdf,
    downloadDocx,
    downloadEpub,
    dispatch,
    t,
  ]);

  const handleCopyToClipboard = useCallback(async () => {
    let textOutput = formattedOutput;
    if (format === 'norm-txt') {
      const { buildNormManuscriptExport } = await import('../services/normPageExport');
      textOutput = buildNormManuscriptExport(
        project.manuscript.map((s) => ({
          title: s.title,
          content: s.content ?? '',
        })),
      );
    } else if (format === 'txt') {
      textOutput = textOutput.replace(/#+\s/g, '').replace(/\*\*(.*?)\*\*/g, '$1');
    }
    try {
      await navigator.clipboard.writeText(textOutput);
    } catch (error) {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('export.error.exportFailed'),
          description: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedOutput, format, project.manuscript, dispatch, t]);

  return {
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
    formattedOutput,
    isExportLoading,
  };
};

export type UseExportViewReturnType = ReturnType<typeof useExportView>;
