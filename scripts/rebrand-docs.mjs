#!/usr/bin/env node
/**
 * Rebrand Markdown docs.
 * - Full rebrand for all .md except docs/history/ and CHANGELOG.md
 * - URL-only rebrand for docs/history/ (forward references)
 * - CHANGELOG.md is handled manually (only recent/head entries)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const EXCLUDED_FILES = new Set([
  join(root, 'CHANGELOG.md'),
  join(root, 'CHECKPOINT-2026-06-06.md'),
  join(root, 'CHECKPOINT-2026-05-24.md'),
  join(root, 'WIEDERAUFNAHME.md'),
]);

function replaceUrls(text) {
  return text
    .replace(/github\.com\/qnbs\/StoryCraft-Studio/g, 'github.com/qnbs/WorldScript-Studio')
    .replace(/github\.com\/QNBS\/StoryCraft-Studio/g, 'github.com/QNBS/WorldScript-Studio')
    .replace(/qnbs\.github\.io\/StoryCraft-Studio/g, 'qnbs.github.io/WorldScript-Studio')
    .replace(/storycraft-studio-indol\.vercel\.app/g, 'worldscript-studio.vercel.app')
    .replace(/storycraft-studio\.vercel\.app/g, 'worldscript-studio.vercel.app')
    .replace(/storycraft-studio\.app/g, 'worldscript-studio.app');
}

function replaceFull(text) {
  return replaceUrls(text)
    .replace(/StoryCraft Studio/g, 'WorldScript Studio')
    .replace(/StoryCraft/g, 'WorldScript')
    .replace(/storyCraft/g, 'worldScript')
    .replace(/storycraft-studio/g, 'worldscript-studio')
    .replace(/storycraft_task_supervisor/g, 'worldscript_task_supervisor')
    .replace(/storycraft-feature-flags/g, 'worldscript-feature-flags')
    .replace(/storycraft:\/\//g, 'worldscript://')
    .replace(/storycraft/g, 'worldscript')
    .replace(/Storycraft/g, 'Worldscript')
    .replace(/STORYCRAFT/g, 'WORLDSCRIPT');
}

function isHistoryPath(full) {
  return full.startsWith(join(root, 'docs', 'history'));
}

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  '.stryker-tmp',
  'coverage',
  '.git',
  '.codegraph',
  'graphify-out',
  '.lighthouseci',
  'e2e-deep-report',
  'storybook-static',
]);

function walk(dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
}

function main() {
  const files = [];
  walk(root, files);

  let changed = 0;
  for (const full of files) {
    if (EXCLUDED_FILES.has(full)) continue;

    const original = readFileSync(full, 'utf8');
    const next = isHistoryPath(full) ? replaceUrls(original) : replaceFull(original);
    if (next !== original) {
      writeFileSync(full, next, 'utf8');
      const rel = full.slice(root.length + 1);
      process.stdout.write(`[rebrand-docs] ${rel}\n`);
      changed++;
    }
  }
  process.stdout.write(`[rebrand-docs] ${changed} files changed\n`);
}

main();
