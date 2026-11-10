#!/usr/bin/env node
// QNBS-v3 (#1223): every COPY/ADD source of the Dockerfile must exist in the build context and must not be excluded by .dockerignore; a stale source fails the container build only at the tag-gated publish job otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const INSTRUCTION = /^(?:COPY|ADD)\s+(.*)$/i;
const UNSUPPORTED = /[*?[\]$]/;

// Joins backslash continuations so one logical instruction is one string.
function logicalLines(text) {
  const lines = [];
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (pending === '' && (trimmed === '' || trimmed.startsWith('#'))) continue;
    pending += trimmed.endsWith('\\') ? `${trimmed.slice(0, -1)} ` : trimmed;
    if (!trimmed.endsWith('\\')) {
      lines.push(pending.trim());
      pending = '';
    }
  }
  if (pending !== '') lines.push(pending.trim());
  return lines;
}

/** Local-context sources of every COPY/ADD (stage copies with --from are not context sources). */
export function dockerfileCopySources(text) {
  const sources = [];
  const errors = [];
  for (const line of logicalLines(text)) {
    const match = INSTRUCTION.exec(line);
    if (!match) continue;
    const words = match[1].split(/\s+/).filter(Boolean);
    if (words.some((word) => word.startsWith('--from='))) continue;
    const operands = words.filter((word) => !word.startsWith('--'));
    if (operands.length < 2 || operands[0].startsWith('[')) {
      errors.push(`unsupported COPY/ADD form: ${line}`);
      continue;
    }
    for (const source of operands.slice(0, -1)) {
      if (UNSUPPORTED.test(source) || /^[a-z]+:\/\//i.test(source)) {
        errors.push(`unsupported COPY/ADD source (wildcard, variable or URL): ${source}`);
      } else sources.push(source);
    }
  }
  return { sources, errors };
}

// Wildcard match without building a RegExp from the pattern; "*" does not cross a "/".
function wildcardMatches(pattern, text) {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === text;
  if (!text.startsWith(parts[0])) return false;
  let position = parts[0].length;
  for (const part of parts.slice(1, -1)) {
    const at = text.indexOf(part, position);
    if (at === -1 || text.slice(position, at).includes('/')) return false;
    position = at + part.length;
  }
  const last = parts.at(-1);
  const rest = text.slice(position);
  return rest.endsWith(last) && !rest.slice(0, rest.length - last.length).includes('/');
}

function patternCovers(pattern, path) {
  return path === pattern || path.startsWith(`${pattern}/`) || wildcardMatches(pattern, path);
}

/** .dockerignore: root-anchored patterns, the last matching pattern wins, "!" re-includes. */
export function dockerignoreExcludes(dockerignoreText, path) {
  let excluded = false;
  for (const raw of dockerignoreText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = (negated ? line.slice(1) : line).replace(/^\/+/, '').replace(/\/+$/, '');
    if (patternCovers(pattern, path)) excluded = !negated;
  }
  return excluded;
}

export function checkDockerfileContext({ dockerfile, dockerignore, exists }) {
  const { sources, errors } = dockerfileCopySources(dockerfile);
  for (const source of sources) {
    const path = source === '.' ? '.' : source.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!exists(path)) errors.push(`COPY/ADD source is missing from the build context: ${source}`);
    else if (path !== '.' && dockerignoreExcludes(dockerignore, path)) {
      errors.push(`COPY/ADD source is excluded by .dockerignore: ${source}`);
    }
  }
  return { ok: errors.length === 0, errors, sources };
}

function main() {
  const root = process.cwd();
  const read = (name) =>
    existsSync(resolve(root, name)) ? readFileSync(resolve(root, name), 'utf8') : '';
  const result = checkDockerfileContext({
    dockerfile: read('Dockerfile'),
    dockerignore: read('.dockerignore'),
    exists: (path) => existsSync(resolve(root, path)),
  });
  for (const error of result.errors) process.stderr.write(`dockerfile-context: ${error}\n`);
  if (result.ok)
    process.stdout.write(
      `dockerfile-context: ${result.sources.length} COPY/ADD sources exist and are not ignored\n`,
    );
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
