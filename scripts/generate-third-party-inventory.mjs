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
import { dirname, join, resolve } from 'node:path';
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

function depthDelta(token) {
  if (token === '(') return 1;
  if (token === ')') return -1;
  return 0;
}

/** True when the first character's parenthesis closes only at the last character. */
function isWrappedByOnePair(text) {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  for (const character of text.slice(0, -1)) {
    depth += depthDelta(character);
    if (depth === 0) return false;
  }
  return true;
}

/** Removes parentheses only when one balanced pair encloses the whole expression. */
function stripOuterParens(expression) {
  let text = expression.trim();
  while (isWrappedByOnePair(text)) text = text.slice(1, -1).trim();
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
    depth += depthDelta(token);
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

function licenseFileNames(directory, extraFiles) {
  const matches = readdirSync(directory).filter((entry) => LICENSE_FILE_PATTERN.test(entry));
  return [...new Set([...extraFiles, ...matches])].sort();
}

function readNormalizedText(path) {
  if (!existsSync(path) || !statSync(path).isFile()) return '';
  // QNBS-v3: CRLF is normalized so Windows and Unix runners produce byte-identical notices.
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').trim();
}

export function readLicenseTexts(directory, extraFiles = []) {
  if (!directory || !existsSync(directory)) return [];
  return licenseFileNames(directory, extraFiles)
    .map((file) => ({ file, text: readNormalizedText(join(directory, file)) }))
    .filter(({ text }) => text !== '');
}

/** A pnpm store directory is `<name with + for />@<version>` followed by `_<peer suffix>` or `/`. */
function isStoreDirectoryFor(path, name, version) {
  const storeKey = `/${name.replace('/', '+')}@${version}`;
  const normalized = path.replaceAll('\\', '/');
  const at = normalized.indexOf(storeKey);
  return at !== -1 && /[_/]/.test(normalized.charAt(at + storeKey.length));
}

function storeDirectory(entry, version) {
  const match = entry.paths.find((path) => isStoreDirectoryFor(path, entry.name, version));
  if (match) return match;
  return entry.versions.length === 1 ? entry.paths[0] : undefined;
}

/** Parses `pnpm licenses list --prod --json` output into components (one per name@version). */
export function collectJsComponents(pnpmLicenses, readTexts = readLicenseTexts) {
  return Object.values(pnpmLicenses)
    .flat()
    .flatMap((entry) =>
      entry.versions.map((version) => ({
        ecosystem: 'npm',
        name: entry.name,
        version,
        license: normalizeLicenseExpression(entry.license),
        homepage: entry.homepage ?? null,
        texts: readTexts(storeDirectory(entry, version)),
      })),
    );
}

function isProcMacro(pkg) {
  return pkg.targets.every((target) => target.kind.includes('proc-macro'));
}

function normalDependencies(node) {
  return (node?.deps ?? [])
    .filter((dependency) => dependency.dep_kinds.some((kind) => kind.kind === null))
    .map((dependency) => dependency.pkg);
}

/**
 * Package ids linked into the binary: reachable from the root through normal edges, never
 * through a proc-macro crate, whose own dependencies run only inside the compiler.
 */
function linkedPackageIds(metadata, packages) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const linked = new Set();
  const stack = [metadata.resolve.root];
  while (stack.length > 0) {
    const id = stack.pop();
    const pkg = packages.get(id);
    if (linked.has(id) || !pkg || isProcMacro(pkg)) continue;
    linked.add(id);
    stack.push(...normalDependencies(nodes.get(id)));
  }
  return linked;
}

function rustComponent(pkg, readTexts) {
  return {
    ecosystem: 'cargo',
    name: pkg.name,
    version: pkg.version,
    license: normalizeLicenseExpression(pkg.license),
    homepage: pkg.homepage ?? pkg.repository ?? null,
    texts: readTexts(dirname(pkg.manifest_path), pkg.license_file ? [pkg.license_file] : []),
  };
}

/** Components for the crates linked into the desktop binary for the metadata's target. */
export function collectRustComponents(metadata, readTexts = readLicenseTexts) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  return [...linkedPackageIds(metadata, packages)]
    .map((id) => packages.get(id))
    .filter((pkg) => pkg.source !== null) // path/workspace crates are WorldScript itself
    .map((pkg) => rustComponent(pkg, readTexts));
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

function bulletList(title, entries) {
  const items = entries.length > 0 ? entries.map((entry) => `  - ${entry}`) : ['  (none)'];
  return [`${title} (${entries.length}):`, ...items, ''];
}

/** Prints each distinct license text once; later identical texts reference the first owner. */
function licenseTextLines(id, texts, firstSeen) {
  return texts.flatMap(({ file, text }) => {
    const digest = createHash('sha256').update(text).digest('hex');
    const earlier = firstSeen.get(digest);
    if (earlier) return ['', `[${file}: identical to the text printed for ${earlier}]`];
    firstSeen.set(digest, id);
    return ['', `[${file}]`, text];
  });
}

function componentLines(component, firstSeen) {
  const id = `${component.ecosystem}:${component.name}@${component.version}`;
  const homepage = component.homepage ? [`Homepage: ${component.homepage}`] : [];
  return [
    '-'.repeat(78),
    id,
    `License: ${component.license}`,
    ...homepage,
    ...licenseTextLines(id, component.texts, firstSeen),
    '',
  ];
}

export function renderNotices(components, context) {
  const sorted = [...components].sort(compareComponents);
  const { review, missingText } = classifyComponents(sorted);
  const firstSeen = new Map();
  const lines = [
    'THIRD-PARTY SOFTWARE NOTICES',
    '============================',
    '',
    ...scopeLines(context),
    '',
    `Components: ${sorted.length}`,
    '',
    ...bulletList('Licenses flagged for human review', review),
    ...bulletList('Components whose package ships no license text', missingText),
    ...sorted.flatMap((component) => componentLines(component, firstSeen)),
  ];
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

const OPTION_KEYS = { '--out': 'out', '--target': 'target' };

function parseArgs(argv) {
  const options = { out: 'third-party', target: null };
  for (let index = 0; index < argv.length; index += 2) {
    const key = OPTION_KEYS[argv[index]];
    if (!key || argv[index + 1] === undefined) throw new Error(`invalid argument: ${argv[index]}`);
    options[key] = argv[index + 1];
  }
  return options;
}

function resolveContext(requestedTarget) {
  const target = requestedTarget ?? /host: (\S+)/.exec(run('rustc', ['-vV']))?.[1];
  if (!target) throw new Error('cannot determine the Rust host target triple');
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const commit = process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD']).trim();
  const epoch = Number(run('git', ['log', '-1', '--format=%ct', commit]).trim());
  return { version, commit, target, timestamp: new Date(epoch * 1000).toISOString() };
}

function collectAllComponents(target) {
  const cargoArgs = ['metadata', '--locked', '--format-version', '1'];
  cargoArgs.push('--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', target);
  const pnpmLicenses = JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json']));
  return [
    ...collectRustComponents(JSON.parse(run('cargo', cargoArgs))),
    ...collectJsComponents(pnpmLicenses),
  ];
}

function writeInventory(outDir, components, context) {
  mkdirSync(outDir, { recursive: true });
  const prefix = `worldscript-studio-${context.version}-${context.target}`;
  const notices = `${prefix}.third-party-notices.txt`;
  const sbom = `${prefix}.cdx.json`;
  writeFileSync(join(outDir, notices), renderNotices(components, context));
  writeFileSync(join(outDir, sbom), renderSbom(components, context));
  return { notices, sbom };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const context = resolveContext(options.target);
  const components = collectAllComponents(context.target);
  const { unclassified, review, missingText } = classifyComponents(components);
  if (unclassified.length > 0) {
    const list = unclassified.map((id) => `  - ${id}`).join('\n');
    console.error(`::error::${unclassified.length} shipped component(s) lack license metadata:`);
    console.error(list);
    process.exitCode = 1;
    return;
  }
  const outDir = resolve(root, options.out);
  const files = writeInventory(outDir, components, context);
  console.log(
    `Third-party inventory for ${context.target}: ${components.length} components ` +
      `(review: ${review.length}, without license text: ${missingText.length}) → ${outDir}`,
  );
  // Bare file names: the workflow composes platform-neutral relative paths from them.
  if (process.env.GITHUB_OUTPUT) {
    const output = `notices_file=${files.notices}\nsbom_file=${files.sbom}\n`;
    writeFileSync(process.env.GITHUB_OUTPUT, output, { flag: 'a' });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
