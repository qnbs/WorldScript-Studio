/**
 * German publishing standard “Normseite”: 30 lines of at most 60 characters each (Courier counting).
 * QNBS-v3: Plain text without UI layout — purely computational line-breaking for publisher/VG-Wort workflows.
 */

export const NORM_PAGE_COLS = 60;
export const NORM_PAGE_ROWS = 30;

/** Removes minimal Markdown decoration elements for plain running text. */
export function stripLightMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** Wraps a paragraph into lines of at most `cols` characters (word boundaries). */
export function wrapParagraphToLines(paragraph: string, cols: number): string[] {
  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  const pushLine = () => {
    lines.push(line.padEnd(cols));
    line = '';
  };
  for (const raw of words) {
    let w = raw;
    while (w.length > cols) {
      if (line.length > 0) pushLine();
      lines.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    const candidate = line.length === 0 ? w : `${line} ${w}`;
    if (candidate.length <= cols) {
      line = candidate;
    } else {
      if (line.length > 0) pushLine();
      line = w;
    }
  }
  if (line.length > 0) pushLine();
  return lines;
}

/** All paragraphs → flat line list (blank lines between paragraphs). */
export function wrapPlainTextToNormLines(body: string, cols: number): string[] {
  const paras = stripLightMarkdown(body).split(/\n+/);
  const out: string[] = [];
  for (const p of paras) {
    if (!p.trim()) {
      out.push('');
      continue;
    }
    out.push(...wrapParagraphToLines(p, cols));
    out.push('');
  }
  return out;
}

/** Gruppiert Zeilen zu Seiten mit Formfeed zwischen Seiten. */
export function paginateNormLines(lines: string[], rows: number, cols: number): string {
  const pages: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    while (buf.length < rows) buf.push(''.padEnd(cols));
    pages.push(buf.slice(0, rows).join('\n'));
    buf = [];
  };
  for (const raw of lines) {
    if (buf.length >= rows) flush();
    buf.push((raw ?? '').slice(0, cols).padEnd(cols));
  }
  if (buf.length > 0) flush();
  return pages.join('\n\n\f\n\n');
}

export function buildNormManuscriptExport(parts: { title: string; content: string }[]): string {
  let body = '';
  for (const p of parts) {
    body += `\n\n${p.title}\n\n`;
    body += p.content ?? '';
  }
  const lines = wrapPlainTextToNormLines(body, NORM_PAGE_COLS);
  return paginateNormLines(lines, NORM_PAGE_ROWS, NORM_PAGE_COLS);
}
