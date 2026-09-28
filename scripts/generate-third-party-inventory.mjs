#!/usr/bin/env node
/**
 * Third-party inventory for the desktop release (#871, durable policy owner #575).
 *
 * Produces, for one Rust target triple:
 *   - `<prefix>.third-party-notices.txt` — human-readable notices with every license text found
 *     in the shipped packages (identical texts are printed once and referenced afterwards);
 *   - `<prefix>.cdx.json` — a CycloneDX 1.5 SBOM of the same component set.
 *
 * Scope (stated in both outputs, never implied as a legal conclusion):
 *   - Rust: crates reachable from the desktop crate through normal (non-dev, non-build)
 *     dependency edges for the target, excluding first-party path crates and proc-macro crates
 *     (compile-time only, not linked into the binary);
 *   - JavaScript: the pnpm production dependency graph, a documented superset of the modules
 *     Vite actually bundles.
 *
 * A component without any license metadata fails the run. Licenses outside the permissive
 * auto-accepted set, non-SPDX identifiers, and packages without a license text are listed for
 * human review instead of being silently classified.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// QNBS-v3: an OR-alternative from this set makes the component auto-accepted; anything else (weak/strong copyleft, font licenses, non-SPDX ids) is surfaced for human review rather than decided here.
export const AUTO_ACCEPTED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 WITH LLVM-exception',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSL-1.0',
  'CC0-1.0',
  'CDLA-Permissive-2.0',
  'ISC',
  'MIT',
  'MIT-0',
  'Unicode-3.0',
  'Unicode-DFS-2016',
  'Unlicense',
  'Zlib',
]);

// Valid SPDX ids that still need review; used only so the SBOM emits `license.id` instead of `license.name`.
const REVIEWED_SPDX_IDS = new Set([
  'AFL-2.1',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'MPL-2.0',
  'OFL-1.1',
  'Python-2.0',
]);

const LICENSE_FILE_PATTERN = /^(?:licen[cs]e|copying|notice|unlicense)(?:[-._].*)?$/i;

const SCOPE_STATEMENT = [
  'Rust scope: crates linked into the desktop binary for this target (normal dependencies;',
  '  first-party path crates and compile-time-only proc-macro crates excluded).',
  'JavaScript scope: the pnpm production dependency graph, a superset of the bundled modules.',
  'This inventory is generated from package metadata and is not a legal opinion.',
];

/** Removes parentheses only when one balanced pair encloses the whole expression. */
function stripOuterParens(expression) {
  let text = expression.trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let enclosesAll = true;
    for (let index = 0; index < text.length - 1; index++) {
      if (text[index] === '(') depth++;
      if (text[index] === ')') depth--;
      if (depth === 0) {
        enclosesAll = false;
        break;
      }
    }
    if (!enclosesAll) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function normalizeLicenseExpression(raw) {
  if (typeof raw !== 'string') return null;
  // Legacy Cargo manifests use "MIT/Apache-2.0"; pnpm may wrap expressions in parentheses.
  const text = raw
    .trim()
    .replace(/\s*\/\s*/g, ' OR ')
    .replace(/\s+/g, ' ');
  if (text === '' || /^(?:unknown|unlicensed|see license in .*)$/i.test(text)) return null;
  return stripOuterParens(text);
}

function splitTopLevel(expression, operator) {
  const parts = [];
  let depth = 0;
  let current = '';
  const tokens = expression.split(/(\(|\)|\s+)/).filter((token) => token !== '');
  for (const token of tokens) {
    if (token === '(') depth++;
    if (token === ')') depth--;
    if (depth === 0 && token === operator) {
      parts.push(current.trim());
      current = '';
    } else {
      current += token;
    }
  }
  parts.push(current.trim());
  return parts.map(stripOuterParens);
}

/** Returns true when the expression is satisfiable using only auto-accepted licenses. */
export function isAutoAccepted(expression) {
  const alternatives = splitTopLevel(expression, 'OR');
  if (alternatives.length > 1) return alternatives.some((part) => isAutoAccepted(part));
  const conjuncts = splitTopLevel(expression, 'AND');
  if (conjuncts.length > 1) return conjuncts.every((part) => isAutoAccepted(part));
  return AUTO_ACCEPTED_LICENSES.has(expression);
}

export function packageUrl(ecosystem, name, version) {
  if (ecosystem === 'npm') {
    const encoded = name.startsWith('@') ? `%40${name.slice(1)}` : name;
    return `pkg:npm/${encoded}@${version}`;
  }
  return `pkg:cargo/${name}@${version}`;
}

export function readLicenseTexts(directory, extraFiles = []) {
  if (!directory || !existsSync(directory)) return [];
  const names = new Set(extraFiles);
  for (const entry of readdirSync(directory)) {
    if (LICENSE_FILE_PATTERN.test(entry)) names.add(entry);
  }
  const texts = [];
  for (const name of [...names].sort()) {
    const path = join(directory, name);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    // QNBS-v3: CRLF is normalized so Windows and Unix runners produce byte-identical notices.
    const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').trim();
    if (text !== '') texts.push({ file: name, text });
  }
  return texts;
}

/** Parses `pnpm licenses list --prod --json` output into components (one per name@version). */
export function collectJsComponents(pnpmLicenses, readTexts = readLicenseTexts) {
  const components = [];
  for (const entries of Object.values(pnpmLicenses)) {
    for (const entry of entries) {
      for (const version of entry.versions) {
        // A pnpm store directory is `<name with + for />@<version>` followed by `_<peer suffix>` or `/`.
        const storeKey = `/${entry.name.replace('/', '+')}@${version}`;
        const directory =
          entry.paths.find((path) => {
            const normalized = path.replaceAll('\\', '/');
            const at = normalized.indexOf(storeKey);
            return at !== -1 && /[_/]/.test(normalized.charAt(at + storeKey.length));
          }) ?? (entry.versions.length === 1 ? entry.paths[0] : undefined);
        components.push({
          ecosystem: 'npm',
          name: entry.name,
          version,
          license: normalizeLicenseExpression(entry.license),
          homepage: entry.homepage ?? null,
          texts: readTexts(directory),
        });
      }
    }
  }
  return components;
}

/** Walks `cargo metadata` from the resolve root through normal edges only. */
export function collectRustComponents(metadata, readTexts = readLicenseTexts) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const reachable = new Set();
  const stack = [metadata.resolve.root];
  while (stack.length > 0) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const dependency of nodes.get(id)?.deps ?? []) {
      if (dependency.dep_kinds.some((kind) => kind.kind === null)) stack.push(dependency.pkg);
    }
  }
  const components = [];
  for (const id of reachable) {
    const pkg = packages.get(id);
    // First-party path/workspace crates carry no registry source; they are WorldScript itself.
    if (!pkg || pkg.source === null) continue;
    if (pkg.targets.every((target) => target.kind.includes('proc-macro'))) continue;
    const directory = dirname(pkg.manifest_path);
    components.push({
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      license: normalizeLicenseExpression(pkg.license),
      homepage: pkg.homepage ?? pkg.repository ?? null,
      texts: readTexts(directory, pkg.license_file ? [pkg.license_file] : []),
    });
  }
  return components;
}

export function compareComponents(a, b) {
  return (
    a.ecosystem.localeCompare(b.ecosystem) ||
    a.name.localeCompare(b.name) ||
    a.version.localeCompare(b.version, undefined, { numeric: true })
  );
}

export function classifyComponents(components) {
  const unclassified = [];
  const review = [];
  const missingText = [];
  for (const component of components) {
    const id = `${component.ecosystem}:${component.name}@${component.version}`;
    if (!component.license) {
      unclassified.push(id);
      continue;
    }
    if (!isAutoAccepted(component.license)) review.push(`${id} (${component.license})`);
    if (component.texts.length === 0) missingText.push(`${id} (${component.license})`);
  }
  return { unclassified, review, missingText };
}

function scopeLines(context) {
  return [
    `Product: WorldScript Studio ${context.version}`,
    `Commit: ${context.commit}`,
    `Target: ${context.target}`,
    ...SCOPE_STATEMENT,
  ];
}

export function renderNotices(components, context) {
  const sorted = [...components].sort(compareComponents);
  const { review, missingText } = classifyComponents(sorted);
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES',
    '============================',
    '',
    ...scopeLines(context),
    '',
    `Components: ${sorted.length}`,
    '',
    `Licenses flagged for human review (${review.length}):`,
    ...(review.length > 0 ? review.map((entry) => `  - ${entry}`) : ['  (none)']),
    '',
    `Components whose package ships no license text (${missingText.length}):`,
    ...(missingText.length > 0 ? missingText.map((entry) => `  - ${entry}`) : ['  (none)']),
    '',
  ];
  const firstSeen = new Map();
  for (const component of sorted) {
    const id = `${component.ecosystem}:${component.name}@${component.version}`;
    lines.push('-'.repeat(78), id, `License: ${component.license}`);
    if (component.homepage) lines.push(`Homepage: ${component.homepage}`);
    for (const { file, text } of component.texts) {
      const digest = createHash('sha256').update(text).digest('hex');
      const earlier = firstSeen.get(digest);
      if (earlier) {
        lines.push('', `[${file}: identical to the text printed for ${earlier}]`);
      } else {
        firstSeen.set(digest, id);
        lines.push('', `[${file}]`, text);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function deterministicUuid(seed) {
  const hex = createHash('sha256').update(seed).digest('hex');
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function licenseEntry(expression) {
  if (/\s(?:OR|AND|WITH)\s/.test(expression)) return [{ expression }];
  const known = AUTO_ACCEPTED_LICENSES.has(expression) || REVIEWED_SPDX_IDS.has(expression);
  // QNBS-v3: a non-SPDX string such as "BSD" must not be emitted as a license id, or the SBOM would assert an identifier that does not exist.
  return [{ license: known ? { id: expression } : { name: expression } }];
}

export function renderSbom(components, context) {
  const sorted = [...components].sort(compareComponents);
  const bomComponents = sorted.map((component) => {
    const purl = packageUrl(component.ecosystem, component.name, component.version);
    return {
      type: 'library',
      'bom-ref': purl,
      name: component.name,
      version: component.version,
      purl,
      licenses: licenseEntry(component.license),
    };
  });
  const body = JSON.stringify(bomComponents);
  return `${JSON.stringify(
    {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${deterministicUuid(`${context.commit}\n${context.target}\n${body}`)}`,
      version: 1,
      metadata: {
        timestamp: context.timestamp,
        tools: {
          components: [
            {
              type: 'application',
              name: 'worldscript-generate-third-party-inventory',
              version: '1',
            },
          ],
        },
        component: {
          type: 'application',
          'bom-ref': 'worldscript-studio',
          name: 'worldscript-studio',
          version: context.version,
          licenses: [{ license: { id: 'MIT' } }],
        },
        properties: [
          { name: 'worldscript:commit', value: context.commit },
          { name: 'worldscript:target', value: context.target },
          { name: 'worldscript:scope', value: SCOPE_STATEMENT.join(' ').replace(/\s+/g, ' ') },
        ],
      },
      components: bomComponents,
    },
    null,
    2,
  )}\n`;
}

function run(command, args) {
  // QNBS-v3: pnpm is a .cmd shim on Windows, which Node only launches through a shell; the arguments are constants, so no untrusted text reaches that shell.
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32' && command === 'pnpm',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function parseArgs(argv) {
  const options = { out: 'third-party', target: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--out') options.out = argv[++index];
    else if (argv[index] === '--target') options.target = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const target = options.target ?? /host: (\S+)/.exec(run('rustc', ['-vV']))?.[1];
  if (!target) throw new Error('cannot determine the Rust host target triple');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const commit = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']).trim();
  const epoch = Number(run('git', ['log', '-1', '--format=%ct', commit]).trim());
  const context = { version, commit, target, timestamp: new Date(epoch * 1000).toISOString() };

  const metadata = JSON.parse(
    run('cargo', [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--filter-platform',
      target,
    ]),
  );
  const components = [
    ...collectRustComponents(metadata),
    ...collectJsComponents(JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json']))),
  ];
  const { unclassified, review, missingText } = classifyComponents(components);
  if (unclassified.length > 0) {
    console.error(`::error::${unclassified.length} shipped component(s) have no license metadata:`);
    for (const id of unclassified) console.error(`  - ${id}`);
    process.exitCode = 1;
    return;
  }

  const outDir = resolve(root, options.out);
  mkdirSync(outDir, { recursive: true });
  const prefix = `worldscript-studio-${version}-${target}`;
  const noticesPath = join(outDir, `${prefix}.third-party-notices.txt`);
  const sbomPath = join(outDir, `${prefix}.cdx.json`);
  writeFileSync(noticesPath, renderNotices(components, context));
  writeFileSync(sbomPath, renderSbom(components, context));

  const summary = [
    `Third-party inventory for ${target}: ${components.length} components`,
    `  review: ${review.length}, without license text: ${missingText.length}`,
    `  ${noticesPath}`,
    `  ${sbomPath}`,
  ];
  console.log(summary.join('\n'));
  if (process.env.GITHUB_OUTPUT) {
    // Bare file names: the workflow composes platform-neutral relative paths from them.
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `notices_file=${basename(noticesPath)}\nsbom_file=${basename(sbomPath)}\n`,
      { flag: 'a' },
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
