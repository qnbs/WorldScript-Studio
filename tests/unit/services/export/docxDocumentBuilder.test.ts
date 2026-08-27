import { Packer } from 'docx';
import { describe, expect, it } from 'vitest';
import { buildDocxDocument } from '../../../../services/export/docxDocumentBuilder';

describe('buildDocxDocument', () => {
  it('produces a genuine DOCX (ZIP-signed) buffer, not markdown or plain text', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
    });
    const buffer = await Packer.toBuffer(doc);
    // QNBS-v3 (DA-05): a .docx file is a ZIP container — its first 4 bytes are the ZIP local-file-header signature.
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('always includes the title and logline', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await import('jszip').then((m) => m.default.loadAsync(buffer));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).toContain('My Novel');
    expect(documentXml).toContain('Logline: A story about courage');
  });

  it('omits the synopsis section when synopsis is not provided', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
      synopsis: null,
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await import('jszip').then((m) => m.default.loadAsync(buffer));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).not.toContain('Synopsis');
  });

  it('includes the synopsis heading and text when provided', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
      synopsis: { heading: 'Synopsis', text: 'A hero rises.' },
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await import('jszip').then((m) => m.default.loadAsync(buffer));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).toContain('Synopsis');
    expect(documentXml).toContain('A hero rises.');
  });

  it('includes manuscript section headings and non-blank paragraphs, skipping blank lines', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
      manuscript: {
        heading: 'Manuscript',
        sections: [{ title: 'Chapter One', content: 'It was a dark night.\n\nThe end.' }],
      },
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await import('jszip').then((m) => m.default.loadAsync(buffer));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).toContain('Manuscript');
    expect(documentXml).toContain('Chapter One');
    expect(documentXml).toContain('It was a dark night.');
    expect(documentXml).toContain('The end.');
  });

  it('omits the manuscript section when manuscript is not provided', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
    });
    const buffer = await Packer.toBuffer(doc);
    const zip = await import('jszip').then((m) => m.default.loadAsync(buffer));
    const documentXml = await zip.file('word/document.xml')?.async('string');
    expect(documentXml).not.toContain('Chapter');
  });

  it('handles a manuscript section with null content without throwing', async () => {
    const doc = buildDocxDocument({
      title: 'My Novel',
      loglineLabel: 'Logline',
      logline: 'A story about courage',
      manuscript: { heading: 'Manuscript', sections: [{ title: 'Empty Chapter', content: null }] },
    });
    const buffer = await Packer.toBuffer(doc);
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
