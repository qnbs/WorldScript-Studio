import { Document, HeadingLevel, Paragraph, TextRun } from 'docx';

export interface DocxManuscriptSection {
  title: string;
  content?: string | null;
}

export interface DocxSynopsisSection {
  heading: string;
  text: string;
}

export interface DocxManuscriptSectionsInput {
  heading: string;
  sections: DocxManuscriptSection[];
}

export interface BuildDocxDocumentOptions {
  title: string;
  loglineLabel: string;
  logline: string;
  synopsis?: DocxSynopsisSection | null;
  manuscript?: DocxManuscriptSectionsInput | null;
}

// QNBS-v3 (DA-05): shared pure Document builder — every DOCX export call site delegates here so DOCX output is never silently Markdown.
export function buildDocxDocument(options: BuildDocxDocumentOptions): Document {
  const children: Paragraph[] = [
    new Paragraph({ text: options.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({ text: `${options.loglineLabel}: ${options.logline}`, italics: true }),
      ],
    }),
  ];

  if (options.synopsis) {
    children.push(
      new Paragraph({ text: options.synopsis.heading, heading: HeadingLevel.HEADING_1 }),
    );
    children.push(new Paragraph({ text: options.synopsis.text }));
  }

  if (options.manuscript) {
    children.push(
      new Paragraph({ text: options.manuscript.heading, heading: HeadingLevel.HEADING_1 }),
    );
    for (const section of options.manuscript.sections) {
      children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));
      for (const paragraph of (section.content ?? '').split('\n')) {
        if (paragraph.trim()) children.push(new Paragraph({ text: paragraph }));
      }
    }
  }

  return new Document({ sections: [{ properties: {}, children }] });
}
