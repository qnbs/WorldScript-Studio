#!/usr/bin/env node
/**
 * Validates static content assets (community templates) before CI merge.
 * Run: node scripts/content-guard.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const COMMUNITY_REL = ['community-templates/index.json', 'public/community-templates/index.json'];

function loadJson(relPath) {
  const p = join(root, relPath);
  return JSON.parse(readFileSync(p, 'utf8'));
}

function assertCommunityTemplates(data, label) {
  if (!Array.isArray(data)) {
    throw new Error(`${label}: expected array`);
  }
  const ids = new Set();
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const prefix = `${label}[${i}]`;
    if (!item || typeof item !== 'object') throw new Error(`${prefix}: expected object`);
    for (const key of ['id', 'name', 'description', 'type', 'author', 'arcDescription']) {
      if (typeof item[key] !== 'string' || item[key].trim() === '') {
        throw new Error(`${prefix}: missing or empty string field "${key}"`);
      }
    }
    if (item.type !== 'Genre' && item.type !== 'Structure') {
      throw new Error(`${prefix}: type must be Genre or Structure`);
    }
    if (!Array.isArray(item.tags) || item.tags.length === 0) {
      throw new Error(`${prefix}: tags must be a non-empty array`);
    }
    if (!Array.isArray(item.sections) || item.sections.length === 0) {
      throw new Error(`${prefix}: sections must be a non-empty array`);
    }
    for (let j = 0; j < item.sections.length; j++) {
      const sec = item.sections[j];
      if (!sec || typeof sec.title !== 'string' || sec.title.trim() === '') {
        throw new Error(`${prefix}.sections[${j}]: title required`);
      }
    }
    if (typeof item.stars !== 'number' || item.stars < 0) {
      throw new Error(`${prefix}: stars must be a non-negative number`);
    }
    if (ids.has(item.id)) throw new Error(`${label}: duplicate id "${item.id}"`);
    ids.add(item.id);
  }
}

function main() {
  const a = loadJson(COMMUNITY_REL[0]);
  const b = loadJson(COMMUNITY_REL[1]);
  assertCommunityTemplates(a, COMMUNITY_REL[0]);
  assertCommunityTemplates(b, COMMUNITY_REL[1]);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(
      'community-templates/index.json and public/community-templates/index.json must be identical — run cp after edits',
    );
  }
  console.log('content-guard: OK (community templates)');
}

main();
