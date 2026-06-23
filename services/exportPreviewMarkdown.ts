// services/exportPreviewMarkdown.ts
//
// QNBS-v3: PR2 — a small, sanitized markdown→HTML renderer for the Export view's "Rendered"
// preview, so the preview reflects real output (headings/paragraphs/emphasis/images) instead of
// only the raw compiled markdown text. Output is always run through DOMPurify with a strict
// allowlist before it reaches innerHTML — no script/style/event-handler vectors survive.

import DOMPurify from 'dompurify';

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Inline span formatting on an already-escaped line: images, bold, italic, inline code. */
function inline(escaped: string): string {
  return escaped
    .replace(IMG_RE, (_m, alt: string, src: string) => `<img src="${src}" alt="${alt}"/>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/** Convert compiled export markdown into a sanitized HTML string for the preview pane. */
export function renderExportMarkdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h1 = /^# (.+)/.exec(line);
    const h2 = /^## (.+)/.exec(line);
    const h3 = /^### (.+)/.exec(line);
    const li = /^[-*] (.+)/.exec(line);

    if (h3) {
      closeList();
      out.push(`<h3>${inline(esc(h3[1] ?? ''))}</h3>`);
    } else if (h2) {
      closeList();
      out.push(`<h2>${inline(esc(h2[1] ?? ''))}</h2>`);
    } else if (h1) {
      closeList();
      out.push(`<h1>${inline(esc(h1[1] ?? ''))}</h1>`);
    } else if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(esc(li[1] ?? ''))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(esc(line))}</p>`);
    }
  }
  closeList();

  return DOMPurify.sanitize(out.join(''), {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'p', 'ul', 'li', 'strong', 'em', 'code', 'img', 'br'],
    ALLOWED_ATTR: ['src', 'alt'],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['style', 'class'],
    SANITIZE_DOM: true,
  });
}
