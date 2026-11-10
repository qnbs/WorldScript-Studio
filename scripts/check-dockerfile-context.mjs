#!/usr/bin/env node
// QNBS-v3 (#1223): every COPY/ADD source of the Dockerfile must exist in the build context and must not be excluded by .dockerignore; a stale source otherwise fails the container build only at the tag-gated publish job.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const COPY_LINE = /^(?:COPY|ADD)\s+(.*)$/i;
const UNSUPPORTED_SOURCE = /[*?[\]$]|^[a-z]+:\/\//i;

const isContentLine = (line) => line !== '' && !line.startsWith('#');

// One logical instruction per string: backslash continuations are joined first.
const logicalLines = (text) =>
  text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isContentLine);

// Operands of a COPY/ADD that reads from the build context; null for any other line and for stage copies (--from).
function copyOperands(line) {
  const match = COPY_LINE.exec(line);
  if (!match) return null;
  const words = match[1].split(/\s+/).filter(Boolean);
  return words.some((word) => word.startsWith('--from='))
    ? null
    : words.filter((w) => !w.startsWith('--'));
}

function instructionResult(line, operands) {
  if (operands.length < 2 || operands[0].startsWith('[')) {
    return { sources: [], errors: [`unsupported COPY/ADD form: ${line}`] };
  }
  const sources = operands.slice(0, -1);
  const unsupported = sources.filter((source) => UNSUPPORTED_SOURCE.test(source));
  return {
    sources: sources.filter((source) => !unsupported.includes(source)),
    errors: unsupported.map(
      (source) => `unsupported COPY/ADD source (wildcard, variable or URL): ${source}`,
    ),
  };
}

/** Context sources of every COPY/ADD, plus the forms this check refuses to interpret (it fails closed on them). */
export function dockerfileCopySources(text) {
  const results = logicalLines(text).flatMap((line) => {
    const operands = copyOperands(line);
    return operands === null ? [] : [instructionResult(line, operands)];
  });
  return {
    sources: results.flatMap((result) => result.sources),
    errors: results.flatMap((result) => result.errors),
  };
}

// The parts between stars must appear in order.
function appearsInOrder(parts, text) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

const hasEnds = (first, last, text) => text.startsWith(first) && text.endsWith(last);

// One path segment against a pattern whose "*" matches any characters (a segment never contains "/").
function segmentMatches(pattern, text) {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === text;
  const [first, last] = [parts[0], parts.at(-1)];
  if (text.length < first.length + last.length) return false;
  if (!hasEnds(first, last, text)) return false;
  return appearsInOrder(parts.slice(1, -1), text.slice(first.length, text.length - last.length));
}

// A pattern covers a path when it matches its leading segments, so a directory pattern covers everything below it.
function patternCovers(pattern, path) {
  const [patternSegments, pathSegments] = [pattern.split('/'), path.split('/')];
  return (
    patternSegments.length <= pathSegments.length &&
    patternSegments.every((segment, index) => segmentMatches(segment, pathSegments[index]))
  );
}

function ignoreRules(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(isContentLine)
    .map((line) => ({
      negated: line.startsWith('!'),
      pattern: line.replace(/^!/, '').replace(/^\/+/, '').replace(/\/+$/, ''),
    }));
}

/** .dockerignore: root-anchored patterns, the last matching pattern wins, "!" re-includes. */
export function dockerignoreExcludes(dockerignoreText, path) {
  return ignoreRules(dockerignoreText).reduce(
    (excluded, rule) => (patternCovers(rule.pattern, path) ? !rule.negated : excluded),
    false,
  );
}

const normalize = (source) =>
  source === '.' ? '.' : source.replace(/^\.\//, '').replace(/\/+$/, '');

function sourceProblem({ source, dockerignore, exists }) {
  const path = normalize(source);
  if (!exists(path)) return `COPY/ADD source is missing from the build context: ${source}`;
  const ignored = path !== '.' && dockerignoreExcludes(dockerignore, path);
  return ignored ? `COPY/ADD source is excluded by .dockerignore: ${source}` : null;
}

export function checkDockerfileContext({ dockerfile, dockerignore, exists }) {
  const { sources, errors } = dockerfileCopySources(dockerfile);
  const problems = sources
    .map((source) => sourceProblem({ source, dockerignore, exists }))
    .filter(Boolean);
  const all = [...errors, ...problems];
  return { ok: all.length === 0, errors: all, sources };
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
