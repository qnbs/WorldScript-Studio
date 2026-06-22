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
  // Rewrite relative repo links → absolute GitHub blob URLs; drop in-page TOC anchors (#...) to plain text.
  result = result.replace(/\]\((?!https?:\/\/|#)([^)]+)\)/g, (_m, p) => `](${GH_BLOB}${p})`);
  result = result.replace(/\]\(#[^)]*\)/g, ']'); // a bare [text](#anchor) → just text (anchor is GH-only)
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
  t = t.replace(/https?:\/\/\S+/g, push); // bare URLs
  t = t.replace(/\*\*/g, push); // bold markers (paired, restored verbatim)
  return { masked: t, tokens };
}

// QNBS-v3: the free MT endpoint occasionally mangles a sentinel bracket (e.g. ⟦1⟧ → "…"1⟧, dropping
// the opening bracket). Restore is therefore tolerant of a missing opening OR closing bracket, and a
// final safety net strips any orphan bracket chars so none can leak into the rendered HTML.
function restoreInline(text, tokens) {
  let r = text;
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

async function translateMarkdown(md, tl, delay) {
  const lines = md.split('\n');
  const result = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    // Verbatim: code fences, blank lines, table rows/separators, pure-markup lines, bare images.
    if (inFence || line.trim() === '' || /^\s*\|/.test(line) || /^\s*[-=*_]{3,}\s*$/.test(line)) {
      result.push(line);
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
    let translated = await translateText(masked, tl);
    translated = restoreInline(translated, tokens);
    result.push(prefix + translated);
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
