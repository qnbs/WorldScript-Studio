/**
 * Serializable compile presets for the Export wizard (offline, no network).
 * QNBS-v3: MVP for Scrivener-like “presets” without a new backend layer.
 */

export type CompileExportFormat = 'md' | 'txt' | 'pdf' | 'docx' | 'epub' | 'norm-txt';

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
  {
    id: 'norm-manuscript-txt',
    nameKey: 'export.compileWizard.presets.normTxt',
    format: 'norm-txt',
    contentToExport: {
      title: false,
      characters: false,
      worlds: false,
      manuscript: true,
    },
  },
];
