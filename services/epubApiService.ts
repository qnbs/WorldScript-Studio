// Client-side EPUB 3.0 Generator (kein Server nötig)
// Verwendet JSZip für vollständige EPUB-3.0-Erzeugung direkt im Browser

import { logger } from './logger';

export interface EpubExportOptions {
  title: string;
  author: string;
  synopsis?: string;
  chapters: Array<{ title: string; content: string }>;
  coverImage?: string; // base64 data URL
  lang?: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const toParagraphs = (text: string) =>
  text
    .split('\n')
    .map((l) => (l.trim() ? `<p>${esc(l.trim())}</p>` : ''))
    .join('');

export async function exportEpub(options: EpubExportOptions): Promise<void> {
  const { title, author, synopsis, chapters, lang = 'de', coverImage } = options;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const uid = `urn:uuid:sc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dateStr = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // mimetype must be first and uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });

  // META-INF
  zip.folder('META-INF')!.file(
    'container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const oebps = zip.folder('OEBPS')!;

  // Stylesheet
  oebps.file(
    'style.css',
    `body{font-family:Georgia,'Times New Roman',serif;font-size:1em;line-height:1.75;margin:5% 8%;color:#1a1a1a;background:#fff}
h1{font-size:2.2em;text-align:center;margin:3em 0 .5em;letter-spacing:.02em}
h2{font-size:1.5em;border-bottom:1px solid #ddd;padding-bottom:.4em;margin-top:2.5em;page-break-after:avoid}
p{margin:.6em 0;text-indent:1.6em}p:first-child,.no-indent{text-indent:0}
.titlepage{text-align:center;padding:20% 0 5%}
.subtitle{font-style:italic;color:#555;font-size:1.1em;margin-top:.2em}
.synopsis-box{background:#f9f9f9;border-left:4px solid #888;padding:1em 1.4em;margin:1.5em 0;font-style:italic}
.chapter-title{page-break-before:always}`,
  );

  const manifest: string[] = [
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
  ];
  const spine: string[] = [];
  const tocEntries: string[] = [];

  // Optional cover image
  if (coverImage?.startsWith('data:image/')) {
    const coverMeta = coverImage.split(';')[0] ?? '';
    const mimeType = coverMeta.split(':')[1] ?? 'application/octet-stream';
    const ext = (mimeType.split('/')[1] ?? 'bin').replace('jpeg', 'jpg');
    const base64 = coverImage.split(',')[1] ?? '';
    if (base64) {
      oebps.file(`cover.${ext}`, base64, { base64: true });
      manifest.push(
        `<item id="cover-img" href="cover.${ext}" media-type="${mimeType}" properties="cover-image"/>`,
        `<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
      );
      spine.push(`<itemref idref="cover-page"/>`);
      oebps.file(
        'cover.xhtml',
        `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head><title>Cover</title>
<style>body{margin:0;padding:0}img{width:100%;height:100vh;object-fit:contain}</style></head>
<body><img src="cover.${ext}" alt="Cover"/></body></html>`,
      );
    }
  }

  // Title page
  oebps.file(
    'titlepage.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><div class="titlepage"><h1>${esc(title)}</h1>
${author ? `<p class="subtitle">${esc(author)}</p>` : ''}</div></body></html>`,
  );
  manifest.push(`<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="titlepage"/>`);
  tocEntries.push(`<li><a href="titlepage.xhtml">${esc(title)}</a></li>`);

  // Synopsis
  if (synopsis?.trim()) {
    oebps.file(
      'synopsis.xhtml',
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>Synopsis</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>Synopsis</h2><div class="synopsis-box">${toParagraphs(synopsis)}</div></body></html>`,
    );
    manifest.push(`<item id="synopsis" href="synopsis.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="synopsis"/>`);
    tocEntries.push(`<li><a href="synopsis.xhtml">Synopsis</a></li>`);
  }

  // Chapters
  chapters.forEach((ch, i) => {
    const id = `ch${i + 1}`;
    const file = `${id}.xhtml`;
    oebps.file(
      file,
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(ch.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2 class="chapter-title">${esc(ch.title)}</h2>
${ch.content?.trim() ? toParagraphs(ch.content) : '<p class="no-indent"><em>(Empty Chapter)</em></p>'}</body></html>`,
    );
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    tocEntries.push(`<li><a href="${file}">${esc(ch.title)}</a></li>`);
  });

  // Navigation (EPUB 3)
  oebps.file(
    'nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${tocEntries.join('\n')}</ol></nav></body></html>`,
  );

  // content.opf
  oebps.file(
    'content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author || 'Unknown')}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:date>${dateStr.slice(0, 10)}</dc:date>
    <meta property="dcterms:modified">${dateStr}</meta>
    <meta name="generator" content="StoryCraft Studio"/>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>
    ${spine.join('\n    ')}
  </spine>
</package>`,
  );

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${
    title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'export'
  }.epub`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Legacy-Kompatibilität – wird nicht mehr für Server-Requests genutzt
export async function exportEpubViaApi(options: EpubExportOptions): Promise<Blob> {
  logger.warn('exportEpubViaApi ist veraltet. Verwende exportEpub() stattdessen.');
  await exportEpub(options);
  return new Blob([], { type: 'application/epub+zip' });
}
