// Client-side EPUB 3.0 Generator (kein Server nötig)
// Verwendet JSZip für vollständige EPUB-3.0-Erzeugung direkt im Browser

import type { CompileProfile } from '../types';
import { logger } from './logger';

export interface EpubExportOptions {
  title: string;
  author: string;
  synopsis?: string;
  chapters: Array<{ title: string; content: string }>;
  coverImage?: string; // base64 data URL
  lang?: string;
  /** Title page, imprint, dedication — inserted after nav title entry. */
  compileProfile?: CompileProfile;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

// QNBS-v3: markdown image token — `![alt](src)`. Only data: URLs are bundled into the EPUB; remote
// URLs are non-conformant inside an EPUB container, so they degrade to their alt text.
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Registers a data-URL image into the EPUB, returning its in-package href (or null to skip). */
type ImageRegistrar = (src: string) => string | null;

interface OebpsFolder {
  file: (name: string, data: string, opts?: { base64?: boolean }) => unknown;
}

/** Book-scoped image registrar: emits data-URL images under images/, dedupes, appends to manifest. */
function createImageRegistrar(oebps: OebpsFolder, manifest: string[]): ImageRegistrar {
  let n = 0;
  const cache = new Map<string, string>();
  return (src: string): string | null => {
    if (!src.startsWith('data:image/')) return null;
    const cached = cache.get(src);
    if (cached) return cached;
    const meta = src.split(';')[0] ?? '';
    const mime = meta.split(':')[1] ?? 'application/octet-stream';
    const ext = (mime.split('/')[1] ?? 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const base64 = src.split(',')[1] ?? '';
    if (!base64) return null;
    n += 1;
    const href = `images/img${n}.${ext}`;
    oebps.file(href, base64, { base64: true });
    manifest.push(`<item id="img${n}" href="${href}" media-type="${mime}"/>`);
    cache.set(src, href);
    return href;
  };
}

/** Escape a line of text while rewriting markdown image tokens to bundled <img> (or alt fallback). */
function renderLine(line: string, registerImage: ImageRegistrar): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(IMG_RE)) {
    const idx = m.index ?? 0;
    out += esc(line.slice(last, idx));
    const alt = m[1] ?? '';
    const href = registerImage(m[2] ?? '');
    out += href ? `<img src="${esc(href)}" alt="${esc(alt)}"/>` : esc(alt);
    last = idx + m[0].length;
  }
  out += esc(line.slice(last));
  return out;
}

/** Split text into <p> blocks, rewriting any inline/standalone markdown images to bundled <img>. */
function renderBody(text: string, registerImage: ImageRegistrar): string {
  return text
    .split('\n')
    .map((l) => {
      const trimmed = l.trim();
      return trimmed ? `<p>${renderLine(trimmed, registerImage)}</p>` : '';
    })
    .join('');
}

export async function exportEpub(options: EpubExportOptions): Promise<void> {
  const { title, author, synopsis, chapters, lang = 'de', coverImage, compileProfile } = options;
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  // QNBS-v3: crypto.randomUUID() instead of Math.random() for unpredictable identifiers (CodeQL js/insecure-randomness)
  const uid = `urn:uuid:${crypto.randomUUID()}`;
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
    // QNBS-v3: NCX for EPUB-2 backward compatibility (older e-readers ignore the EPUB-3 nav doc).
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
  ];
  const spine: string[] = [];
  // QNBS-v3: structured TOC entries — drive BOTH the EPUB-3 nav.xhtml and the EPUB-2 toc.ncx.
  const navList: Array<{ href: string; label: string }> = [];
  // QNBS-v3: bundle data-URL images referenced from manuscript/front-matter markdown into the EPUB.
  const registerImage = createImageRegistrar(oebps, manifest);

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

  // Title page — optional Markdown body from compile profile (Scrivener-style front matter).
  const titleInner = compileProfile?.titlePageMarkdown?.trim()
    ? `<div class="titlepage">${renderBody(compileProfile.titlePageMarkdown, registerImage)}</div>`
    : `<div class="titlepage"><h1>${esc(title)}</h1>
${author ? `<p class="subtitle">${esc(author)}</p>` : ''}</div>`;
  oebps.file(
    'titlepage.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>${titleInner}</body></html>`,
  );
  manifest.push(`<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`<itemref idref="titlepage"/>`);
  navList.push({ href: 'titlepage.xhtml', label: title });

  let extraIdx = 0;
  const pushCompilePage = (navLabel: string, markdown: string) => {
    const id = `compile-${extraIdx++}`;
    const file = `${id}.xhtml`;
    oebps.file(
      file,
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(navLabel)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>${esc(navLabel)}</h2>${renderBody(markdown, registerImage)}</body></html>`,
    );
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navList.push({ href: file, label: navLabel });
  };

  if (compileProfile?.dedicationMarkdown?.trim()) {
    pushCompilePage('Dedication', compileProfile.dedicationMarkdown);
  }
  if (compileProfile?.imprintMarkdown?.trim()) {
    pushCompilePage('Imprint', compileProfile.imprintMarkdown);
  }
  for (const block of compileProfile?.frontMatter ?? []) {
    const id = `compile-${extraIdx++}`;
    const file = `${id}.xhtml`;
    oebps.file(
      file,
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(block.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>${esc(block.title)}</h2>${renderBody(block.bodyMarkdown, registerImage)}</body></html>`,
    );
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navList.push({ href: file, label: block.title });
  }

  // Synopsis
  if (synopsis?.trim()) {
    oebps.file(
      'synopsis.xhtml',
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>Synopsis</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>Synopsis</h2><div class="synopsis-box">${renderBody(synopsis, registerImage)}</div></body></html>`,
    );
    manifest.push(`<item id="synopsis" href="synopsis.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="synopsis"/>`);
    navList.push({ href: 'synopsis.xhtml', label: 'Synopsis' });
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
${ch.content?.trim() ? renderBody(ch.content, registerImage) : '<p class="no-indent"><em>(Empty Chapter)</em></p>'}</body></html>`,
    );
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navList.push({ href: file, label: ch.title });
  });

  if (compileProfile?.acknowledgementsMarkdown?.trim()) {
    pushCompilePage('Acknowledgements', compileProfile.acknowledgementsMarkdown);
  }
  for (const block of compileProfile?.backMatter ?? []) {
    const id = `compile-${extraIdx++}`;
    const file = `${id}.xhtml`;
    oebps.file(
      file,
      `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head>
<title>${esc(block.title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h2>${esc(block.title)}</h2>${renderBody(block.bodyMarkdown, registerImage)}</body></html>`,
    );
    manifest.push(`<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navList.push({ href: file, label: block.title });
  }

  // Navigation (EPUB 3)
  const navItems = navList
    .map((e) => `<li><a href="${esc(e.href)}">${esc(e.label)}</a></li>`)
    .join('\n');
  oebps.file(
    'nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head><title>Table of Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems}</ol></nav></body></html>`,
  );

  // QNBS-v3: NCX (EPUB-2) — same entries as nav.xhtml so EPUB-2-only readers still get a working TOC.
  const navPoints = navList
    .map(
      (e, i) =>
        `<navPoint id="navpt-${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(
          e.label,
        )}</text></navLabel><content src="${esc(e.href)}"/></navPoint>`,
    )
    .join('\n    ');
  oebps.file(
    'toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`,
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
    <meta name="generator" content="WorldScript Studio"/>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
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
