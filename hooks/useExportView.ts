import { useCallback, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectAllCharacters, selectAllWorlds } from '../features/project/projectSelectors';
import { generateSynopsisThunk } from '../features/project/thunks/writingThunks';
import { statusActions } from '../features/status/statusSlice';
import { useTranslation } from './useTranslation';

type Format = 'md' | 'txt' | 'pdf' | 'docx' | 'epub';
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

  const formattedOutput = useMemo(() => {
    let output = '';
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
    return output.trim();
  }, [project, characters, worlds, contentToExport, aiEnhancements, synopsis, t]);

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
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder('OEBPS');

      // Mimetype
      zip.file('mimetype', 'application/epub+zip');

      // Container XML
      zip.folder('META-INF')?.file(
        'container.xml',
        `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`,
      );

      // Content
      let contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${project.title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>
`;
      let spineRef = `<itemref idref="titlepage"/>`;
      let tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:12345"/></head>
<docTitle><text>${project.title}</text></docTitle>
<navMap>
<navPoint id="navPoint-1" playOrder="1"><navLabel><text>Title Page</text></navLabel><content src="titlepage.xhtml"/></navPoint>
`;

      // Title Page
      folder?.file(
        'titlepage.xhtml',
        `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${project.title}</title></head>
<body><h1>${project.title}</h1><p><i>${project.logline}</i></p></body></html>`,
      );

      let chapterCount = 2;

      if (synopsis) {
        contentOpf += `<item id="synopsis" href="synopsis.xhtml" media-type="application/xhtml+xml"/>\n`;
        spineRef += `<itemref idref="synopsis"/>\n`;
        tocNcx += `<navPoint id="navPoint-${chapterCount}" playOrder="${chapterCount}"><navLabel><text>AI Synopsis</text></navLabel><content src="synopsis.xhtml"/></navPoint>\n`;
        chapterCount++;

        const synopsisHtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>AI Synopsis</title></head>
<body><h2>AI Synopsis</h2>${synopsis
          .split('\n')
          .map((p) => (p.trim() ? `<p>${p}</p>` : ''))
          .join('')}</body></html>`;
        folder?.file('synopsis.xhtml', synopsisHtml);
      }

      if (contentToExport.manuscript) {
        project.manuscript.forEach((section, idx) => {
          const id = `chap${idx}`;
          const filename = `${id}.xhtml`;
          contentOpf += `<item id="${id}" href="${filename}" media-type="application/xhtml+xml"/>\n`;
          spineRef += `<itemref idref="${id}"/>\n`;
          tocNcx += `<navPoint id="navPoint-${chapterCount}" playOrder="${chapterCount}"><navLabel><text>${section.title}</text></navLabel><content src="${filename}"/></navPoint>\n`;
          chapterCount++;

          const htmlContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${section.title}</title></head>
<body><h2>${section.title}</h2>${section.content
            .split('\n')
            .map((p) => (p.trim() ? `<p>${p}</p>` : ''))
            .join('')}</body></html>`;
          folder?.file(filename, htmlContent);
        });
      }

      contentOpf += `</manifest>\n<spine toc="ncx">\n${spineRef}\n</spine>\n</package>`;
      tocNcx += `</navMap>\n</ncx>`;

      folder?.file('content.opf', contentOpf);
      folder?.file('toc.ncx', tocNcx);

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title}.epub`;
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
  }, [project, contentToExport, synopsis, dispatch, t]);

  const handleDownload = useCallback(async () => {
    try {
      if (format === 'pdf') {
        await downloadPdf();
      } else if (format === 'docx') {
        await downloadDocx();
      } else if (format === 'epub') {
        await downloadEpub();
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
    downloadPdf,
    downloadDocx,
    downloadEpub,
    dispatch,
    t,
  ]);

  const handleCopyToClipboard = useCallback(async () => {
    let textOutput = formattedOutput;
    if (format === 'txt') {
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
  }, [formattedOutput, format, dispatch, t]);

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
