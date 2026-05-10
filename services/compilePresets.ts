/**
 * Serializable compile presets for the Export wizard (offline, no network).
 * QNBS-v3: MVP für Scrivener-ähnliche „Presets“ ohne neue Backend-Schicht.
 */

export type CompileExportFormat = 'md' | 'txt' | 'pdf' | 'docx' | 'epub';

export interface CompilePresetDefinition {
  id: string;
  /** i18n key (export.compileWizard.presets.*) */
  nameKey: string;
  format: CompileExportFormat;
  contentToExport: {
    title: boolean;
    characters: boolean;
    worlds: boolean;
    manuscript: boolean;
  };
  pdfOptions?: {
    font?: 'Times' | 'Courier' | 'Helvetica';
    fontSize?: 11 | 12;
    lineSpacing?: 'single' | 'double';
    includeTitlePage?: boolean;
  };
}

export const COMPILE_PRESETS: CompilePresetDefinition[] = [
  {
    id: 'novel-manuscript-pdf',
    nameKey: 'export.compileWizard.presets.novelPdf',
    format: 'pdf',
    contentToExport: {
      title: true,
      characters: false,
      worlds: false,
      manuscript: true,
    },
    pdfOptions: {
      font: 'Times',
      fontSize: 12,
      lineSpacing: 'double',
      includeTitlePage: true,
    },
  },
  {
    id: 'full-archive-md',
    nameKey: 'export.compileWizard.presets.fullMd',
    format: 'md',
    contentToExport: {
      title: true,
      characters: true,
      worlds: true,
      manuscript: true,
    },
  },
  {
    id: 'ebook-epub',
    nameKey: 'export.compileWizard.presets.ebookEpub',
    format: 'epub',
    contentToExport: {
      title: true,
      characters: false,
      worlds: false,
      manuscript: true,
    },
  },
];
