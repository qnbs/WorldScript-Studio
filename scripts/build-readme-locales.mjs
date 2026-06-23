#!/usr/bin/env node
/**
 * QNBS-v3: PR5 i18n — builds the localized in-app README help pages.
 *
 * README.md is the SSOT. This script CURATES it (strips GitHub-only chrome: shields badges, the TOC,
 * the duplicate German section, HTML comments; rewrites relative links to absolute GitHub URLs),
 * machine-translates the curated markdown per locale (glossary-anchored, with markdown-aware masking so
 * links/code/emphasis survive the free MT endpoint — the same technique bulk-translate uses for
 * `{{placeholders}}`), renders markdown→HTML at build time via `marked`, and writes one static
 * `public/readme/<lang>.html` per locale. These are fetched lazily by the README help page — they are
 * NOT in the i18n bundle, so they add zero weight to the app's initial load.
 *
 * Usage:
 *   node scripts/build-readme-locales.mjs --lang=en              # curate + render English only
 *   node scripts/build-readme-locales.mjs --lang=de,fr --delay=600
 *   node scripts/build-readme-locales.mjs --all --delay=600      # every supported locale
 *   node scripts/build-readme-locales.mjs --all --dry-run        # curate + render, no translation
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { getLocales, REF_LANG } from './i18n-locales.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'readme');
const GH_BLOB = 'https://github.com/qnbs/WorldScript-Studio/blob/main/';
const FREE_ENDPOINT =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={{tl}}&dt=t&q={{q}}';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const all = args.includes('--all');
  const langArg = get('lang');
  return {
    langs: all ? getLocales() : langArg ? langArg.split(',') : [REF_LANG],
    delay: Number(get('delay') ?? 500),
    dryRun: args.includes('--dry-run'),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Curation: README.md → clean, app-appropriate markdown ----------------------------------------
function curate(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  let inHtmlBlock = false;
  while (i < lines.length) {
    const line = lines[i];
    // Drop the centered badge block <p align="center">…</p> (shields.io images, not localizable).
    if (/^<p align="center">/.test(line)) {
      while (i < lines.length && !/<\/p>/.test(lines[i])) i++;
      i++; // skip the closing </p>
      continue;
    }
    // Drop the leading DeepWiki badge line and bare <img>/<a> chrome lines.
    if (/^\[!\[Ask DeepWiki\]/.test(line)) {
      i++;
      continue;
    }
    // Drop HTML comments (single and multi-line).
    if (/^\s*<!--/.test(line)) {
      inHtmlBlock = true;
    }
    if (inHtmlBlock) {
      if (/-->/.test(line)) inHtmlBlock = false;
      i++;
      continue;
    }
    // Drop the Table of Contents section (heading through the following horizontal rule).
    if (/^##\s+.*Table of Contents/i.test(line)) {
      i++;
      while (i < lines.length && !/^---\s*$/.test(lines[i])) i++;
      i++; // skip the --- rule
      continue;
    }
    // Drop the duplicate German section (it is localized per-locale here) — from its heading to EOF.
    if (/^##\s+.*(Deutsch|🇩🇪)/i.test(line)) break;
    out.push(line);
    i++;
  }
  let result = out.join('\n');
  // Rewrite relative repo links → absolute GitHub blob URLs.
  result = result.replace(/\]\((?!https?:\/\/|#)([^)]+)\)/g, (_m, p) => `](${GH_BLOB}${p})`);
  // QNBS-v3: in-page anchors (#section) point at README headings that exist on GitHub but not in this
  // standalone page. Rewrite them to the absolute GitHub README anchor so they stay CLICKABLE — do NOT
  // strip the `(#anchor)` to a bare `[text]`, which marked renders as non-clickable bracketed text.
  result = result.replace(
    /\]\((#[^)]*)\)/g,
    (_m, anchor) => `](https://github.com/qnbs/WorldScript-Studio${anchor})`,
  );
  // Collapse 3+ blank lines.
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

// --- Markdown-aware masking so MT preserves links / code / emphasis -------------------------------
function maskInline(text) {
  const tokens = [];
  const push = (m) => {
    tokens.push(m);
    return `⟦${tokens.length - 1}⟧`;
  };
  let t = text;
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, push); // images (whole)
  t = t.replace(/`[^`]+`/g, push); // inline code (whole span — includes the backticks)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `[${label}]${push(`(${url})`)}`); // keep link text, mask url
  t = t.replace(/https?:\/\/\S+/g, push); // bare URLs (mask BEFORE emphasis so `_` in a URL isn't read as <em>)
  // QNBS-v3: emphasis is converted to HTML tags up-front and the TAGS (not the inner text) are masked as
  // opaque sentinels. The free MT endpoint spaces/shifts paired `**` delimiters, so restoring them as
  // markdown produced invalid `** text **` that marked left as literal `**` in the rendered help page
  // (CodeAnt: raw `**` leaked into every non-English page). A single opaque `<strong>` sentinel round-trips
  // as cleanly as a link/code sentinel; the inner text still gets translated. marked passes the inline HTML
  // through verbatim at build time, so the final page renders proper bold/italic.
  t = t.replace(
    /\*\*([^*]+?)\*\*/g,
    (_m, inner) => `${push('<strong>')}${inner}${push('</strong>')}`,
  );
  t = t.replace(
    /(^|[^\w*])_([^_\n]+?)_(?=[^\w]|$)/g,
    (_m, pre, inner) => `${pre}${push('<em>')}${inner}${push('</em>')}`,
  );
  t = t.replace(/\*\*/g, ''); // drop any UNPAIRED `**` from malformed source/MT so it can never leak
  // QNBS-v3: protect security-critical crypto identifiers + size units from number-mangling MT
  // (CodeAnt: `AES-256-GCM, 12-byte` came back as `AES-2516-byte` in he.html — a wrong crypto parameter).
  t = t.replace(/\b(?:AES-256-GCM|AES-256|SHA-256|SHA-1|PBKDF2|HMAC|RSA|ECDSA)\b/g, push);
  t = t.replace(/\b\d[\d,. ]*-(?:byte|bit)\b/g, push); // 12-byte / 256-bit units
  return { masked: t, tokens };
}

// QNBS-v3: the free MT endpoint occasionally mangles a sentinel bracket (e.g. ⟦1⟧ → "…"1⟧, dropping
// the opening bracket). Restore is therefore tolerant of a missing opening OR closing bracket, and a
// final safety net strips any orphan bracket chars so none can leak into the rendered HTML.
function restoreInline(text, tokens) {
  // QNBS-v3: MT sometimes inserts a space between a link's `]` and the masked URL sentinel
  // (`[text] ⟦n⟧`), which would restore to `[text] (url)` — NOT a valid markdown link. Re-close the
  // gap before restoring so the link survives.
  let r = text.replace(/\]\s+⟦/g, ']⟦');
  for (let i = 0; i < tokens.length; i++) {
    const patterns = [`⟦\\s*${i}\\s*⟧`, `⟦?\\s*${i}\\s*⟧`, `⟦\\s*${i}\\s*⟧?`];
    for (const p of patterns) {
      const re = new RegExp(p, 'g');
      if (re.test(r)) {
        r = r.replace(new RegExp(p, 'g'), () => tokens[i]);
        break;
      }
    }
  }
  return r.replace(/[⟦⟧]/g, ''); // safety net: drop any orphan bracket the MT endpoint mangled
}

async function translateText(text, tl) {
  const url = FREE_ENDPOINT.replace('{{tl}}', tl).replace('{{q}}', encodeURIComponent(text));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url);
      // QNBS-v3: 429 = the free endpoint rate-limited us; back off harder and retry.
      if (res.status === 429) throw new Error('429');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.[0]) return data[0].map((seg) => seg[0]).join('');
      throw new Error('bad shape');
    } catch {
      // QNBS-v3: never crash the whole run on one failed line — after the final retry, keep the
      // (masked) English text so the page stays structurally intact and the run completes. Rare
      // English lines are an acceptable degradation; a crash that loses 9 locales is not.
      if (attempt === 3) return text;
      await sleep(1500 * (attempt + 1));
    }
  }
  return text;
}

const PREFIX = /^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+))?(.*)$/;

// QNBS-v3: structural sanity guard. The free MT endpoint mangles a line's markup in many ways
// (dropping a sentinel, duplicating a masked filename token, breaking `[text] (url)` link adjacency,
// losing a code span / emphasis). Rather than chase each syntax case, we RENDER both the English and
// the translated line's inline markdown and require the resulting structural element counts to be
// IDENTICAL. This is exactly the invariant the readmeLocales guard enforces doc-wide, applied per line
// — a line is accepted only when its links/code/emphasis render like the English source; otherwise we
// keep the English line. Block structure (headings/list items/fences/tables) is already preserved by
// prefix-extraction + verbatim handling, so checking inline elements is sufficient.
function inlineSignature(md) {
  let html;
  try {
    html = marked.parseInline(md);
  } catch {
    return null; // unrenderable → treat as not-sound (fall back to English)
  }
  // QNBS-v3: links, code/filenames AND emphasis must all match exactly. Emphasis is now masked as opaque
  // <strong>/<em> tag-sentinels (not fragile paired `**`), so it round-trips reliably — requiring parity
  // no longer rejects prose lines, and it deterministically catches the raw-`**`/`<em>` leakage CodeAnt
  // flagged (a corrupted line gets a different tag count → falls back to English instead of shipping garbage).
  return [
    (html.match(/<a\s/g) || []).length,
    (html.match(/<code>/g) || []).length,
    (html.match(/<strong>/g) || []).length,
    (html.match(/<em>/g) || []).length,
  ].join(',');
}

function isStructurallySound(body, restored) {
  // QNBS-v3: compare the RESTORED line (sentinels already substituted back / stripped by the safety
  // net) against the English source. Do NOT test the raw MT output for sentinels — it legitimately
  // still contains `⟦n⟧` before restore, so checking it there rejected every masked line (→ 86%
  // English). If a masked token was actually lost, the link/code signature below won't match → fallback.
  if (/[⟦⟧]/.test(restored)) return false;
  const en = inlineSignature(body);
  return en !== null && en === inlineSignature(restored);
}

async function translateMarkdown(md, tl, delay) {
  const lines = md.split('\n');
  const result = [];
  let inFence = false;
  for (const line of lines) {
    // QNBS-v3: match indented fences too (e.g. a ```bash block nested in a list item) — anchoring at
    // column 0 would miss them, translate their content, and drop a <pre> block.
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    // Verbatim: code fences, blank lines, pure-markup/rule lines.
    if (inFence || line.trim() === '' || /^\s*[-=*_]{3,}\s*$/.test(line)) {
      result.push(line);
      continue;
    }
    // QNBS-v3: table rows — translate each CELL (preserving the `|` structure) so feature tables are
    // localized too, not left English. The alignment/separator row (e.g. `|---|:--|`) stays verbatim.
    if (/^\s*\|/.test(line)) {
      if (/^[\s|:-]+$/.test(line)) {
        result.push(line);
        continue;
      }
      const cells = line.split('|');
      const out = [];
      for (const cell of cells) {
        if (cell.trim() === '') {
          out.push(cell);
          continue;
        }
        const lead = cell.match(/^\s*/)?.[0] ?? '';
        const trail = cell.match(/\s*$/)?.[0] ?? '';
        const inner = cell.slice(lead.length, cell.length - trail.length);
        const { masked, tokens } = maskInline(inner);
        const tr = restoreInline(await translateText(masked, tl), tokens);
        out.push(lead + (isStructurallySound(inner, tr) ? tr : inner) + trail);
        if (delay) await sleep(delay);
      }
      result.push(out.join('|'));
      continue;
    }
    const m = line.match(PREFIX);
    const prefix = m?.[1] ?? '';
    const body = m?.[2] ?? line;
    if (body.trim() === '') {
      result.push(line);
      continue;
    }
    const { masked, tokens } = maskInline(body);
    const translated = await translateText(masked, tl);
    const restored = restoreInline(translated, tokens);
    // Keep the English line if MT broke the markup structure (see isStructurallySound).
    result.push(prefix + (isStructurallySound(body, restored) ? restored : body));
    if (delay) await sleep(delay);
  }
  return result.join('\n');
}

// --- HTML rendering (build time) ------------------------------------------------------------------
marked.setOptions({ gfm: true, breaks: false });

// QNBS-v3: curate + renderHtml are exported so the drift guard (tests/unit/help/readmeDrift.test.ts)
// can verify public/readme/en.html matches the current README.md without any network/MT.
export { curate };
export function renderHtml(md, lang) {
  const body = marked.parse(md);
  // A self-contained fragment; the README help page injects it (DOMPurify-sanitized) into the prose div.
  return `<!-- generated by scripts/build-readme-locales.mjs — do not edit; lang=${lang} -->\n${body}`;
}

async function main() {
  const { langs, delay, dryRun } = parseArgs();
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const curated = curate(readme);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  for (const lang of langs) {
    if (lang === REF_LANG) {
      writeFileSync(join(OUT_DIR, 'en.html'), renderHtml(curated, 'en'), 'utf8');
      console.log(`[readme] en → public/readme/en.html (${curated.length} chars curated)`);
      continue;
    }
    if (dryRun) {
      console.log(`[readme] (dry-run) would translate → ${lang}`);
      continue;
    }
    console.log(`[readme] translating → ${lang} …`);
    const translated = await translateMarkdown(curated, lang, delay);
    writeFileSync(join(OUT_DIR, `${lang}.html`), renderHtml(translated, lang), 'utf8');
    console.log(`[readme] ${lang} → public/readme/${lang}.html`);
  }
  console.log('[readme] done.');
}

// QNBS-v3: only run when invoked directly (`node scripts/build-readme-locales.mjs`), not when the
// drift-guard test imports curate/renderHtml — otherwise importing it would kick off the MT run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
