import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportEpub } from '../../services/epubApiService';

// QNBS-v3: capture every file written into the EPUB so we can assert on the generated XML/structure.
const h = vi.hoisted(() => ({ files: {} as Record<string, string> }));

vi.mock('jszip', () => {
  class MockJSZip {
    file(name: string, data: unknown) {
      if (typeof data === 'string') h.files[name] = data;
      return this;
    }
    folder() {
      // Folder writes land in the same flat map keyed by their bare path (e.g. 'images/img1.png').
      return this;
    }
    generateAsync() {
      return Promise.resolve(new Blob(['mock-epub'], { type: 'application/epub+zip' }));
    }
  }
  return { default: MockJSZip };
});

function stubDownload() {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:mock'),
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
  const anchor = document.createElement('a');
  const click = vi.fn();
  vi.spyOn(anchor, 'click').mockImplementation(click);
  vi.spyOn(anchor, 'remove').mockImplementation(() => {});
  vi.spyOn(document, 'createElement').mockReturnValue(anchor);
  return { anchor, click };
}

describe('epubApiService', () => {
  beforeEach(() => {
    h.files = {};
    vi.restoreAllMocks();
  });

  it('exports a valid epub blob', async () => {
    const { anchor, click } = stubDownload();
    await exportEpub({
      title: 'Test Buch',
      author: 'Test Autor',
      chapters: [{ title: 'Kapitel 1', content: 'Inhalt des ersten Kapitels.' }],
    });
    expect(click).toHaveBeenCalledOnce();
    // Service sanitizes spaces to underscores in filename
    expect(anchor.download).toBe('Test_Buch.epub');
  });

  it('uses provided language', async () => {
    const { click } = stubDownload();
    await exportEpub({ title: 'My Book', author: 'Author', chapters: [], lang: 'en' });
    expect(click).toHaveBeenCalledOnce();
    expect(h.files['toc.ncx']).toContain('xml:lang="en"');
  });

  it('generates an EPUB-2 toc.ncx and references it from the spine + manifest', async () => {
    stubDownload();
    await exportEpub({
      title: 'My Book',
      author: 'Author',
      chapters: [{ title: 'Chapter One', content: 'Body.' }],
    });
    const ncx = h.files['toc.ncx'];
    expect(ncx).toBeDefined();
    expect(ncx).toContain('<navMap>');
    expect(ncx).toContain('<navPoint');
    expect(ncx).toContain('Chapter One');

    const opf = h.files['content.opf'];
    expect(opf).toContain('<spine toc="ncx">');
    expect(opf).toContain('media-type="application/x-dtbncx+xml"');
  });

  it('bundles inline data-URL images and rewrites them to <img>', async () => {
    stubDownload();
    await exportEpub({
      title: 'Img Book',
      author: 'A',
      chapters: [{ title: 'Ch', content: 'Before\n![a cat](data:image/png;base64,AAAA)\nAfter' }],
    });
    // image emitted into images/ and registered in the manifest
    const imgKey = Object.keys(h.files).find((k) => k.startsWith('images/img1.'));
    expect(imgKey).toBe('images/img1.png');
    expect(h.files['content.opf']).toContain('href="images/img1.png"');
    // chapter xhtml references the bundled image with its alt text preserved
    expect(h.files['ch1.xhtml']).toContain('<img src="images/img1.png" alt="a cat"/>');
  });

  it('degrades remote image URLs to alt text (EPUB cannot bundle remote)', async () => {
    stubDownload();
    await exportEpub({
      title: 'Remote Book',
      author: 'A',
      chapters: [{ title: 'Ch', content: '![remote pic](https://example.com/p.png)' }],
    });
    const ch = h.files['ch1.xhtml'];
    expect(ch).toContain('remote pic');
    expect(ch).not.toContain('<img');
    expect(Object.keys(h.files).some((k) => k.startsWith('images/'))).toBe(false);
  });
});
