#!/usr/bin/env node
/**
 * Verify each Tauri plugin's Rust crate (src-tauri/Cargo.lock) and every workspace importer's
 * coupled npm package (pnpm-lock.yaml resolved version, not the package.json declared range)
 * share the same major.minor line.
 * Run via ci:prepush or manually:
 *   node scripts/check-tauri-plugin-versions.mjs
 */
// QNBS-v3: tauri build rejects this mismatch too, but only inside the slow, tag-triggered, cross-platform release workflow — mirrors that check cheaply for regular CI (found live: v1.28.5's Rust-only plugin bump via #661 broke every platform's release build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
const pnpmLockPath = path.join(root, 'pnpm-lock.yaml');
const rootPkgPath = path.join(root, 'package.json');
const packagesDir = path.join(root, 'packages');

// QNBS-v3 (codex): tauri-plugin-log, -window-state, and -deep-link all have real @tauri-apps/plugin-* npm packages too (verified against the npm registry) even though this repo doesn't declare them in package.json yet — listed here so the guard covers them immediately if that ever changes. Only tauri-plugin-single-instance genuinely has no npm counterpart (confirmed 404).
const PLUGIN_CRATE_NAMES = [
  'tauri-plugin-deep-link',
  'tauri-plugin-dialog',
  'tauri-plugin-fs',
  'tauri-plugin-http',
  'tauri-plugin-log',
  'tauri-plugin-notification',
  'tauri-plugin-process',
  'tauri-plugin-shell',
  'tauri-plugin-updater',
  'tauri-plugin-window-state',
];
const crateToNpmName = (crateName) => `@tauri-apps/${crateName.replace(/^tauri-/, '')}`;

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

// QNBS-v3: only the exact leading semver (2.6.0) is kept — a resolved lockfile version can carry a trailing "(patch_hash=...)" or peer-suffix annotation that must not corrupt the comparison.
function majorMinor(version) {
  const match = version.match(/^(\d+)\.(\d+)\.\d+/);
  return match ? `${match[1]}.${match[2]}` : null;
}

// QNBS-v3 (cubic): Cargo.lock qualifies a same-named dependency as "name version" inside its owning package's own dependencies list only when more than one resolved version of that crate exists — reading this authoritative signal avoids ever mistaking a transitive occurrence for the direct app dependency.
function directDependencyReferences(cargoLock) {
  const ownPackageMatch = cargoLock.match(
    /name = "worldscript-studio"\n(?:[^\n]*\n)*?dependencies = \[\n([^\]]*)\]/,
  );
  const references = new Map();
  if (!ownPackageMatch) return references;
  for (const line of ownPackageMatch[1].split('\n')) {
    const depMatch = line.match(/"([^"]+)"/);
    if (!depMatch) continue;
    const [name, version] = depMatch[1].split(' ');
    references.set(name, version ?? null);
  }
  return references;
}

function allResolvedVersionsOf(cargoLock, crateName) {
  const regex = new RegExp(`name = "${crateName}"\\nversion = "([^"]+)"`, 'g');
  const versions = [];
  for (const match of cargoLock.matchAll(regex)) versions.push(match[1]);
  return versions;
}

// QNBS-v3: a crate absent from the returned map has no resolved version at all; a crate mapped to null was found more than once in Cargo.lock with no disambiguating reference — both are distinct fail-closed states, never guessed.
export function resolvedCargoPluginVersions(cargoLock) {
  const normalized = normalizeLineEndings(cargoLock);
  const references = directDependencyReferences(normalized);
  const resolved = new Map();
  for (const crateName of PLUGIN_CRATE_NAMES) {
    // QNBS-v3 (codex): a crate absent from worldscript-studio's own dependencies list is at most a transitive occurrence, even with only one lockfile entry — leaving it unset here routes it through the existing "no resolved version" fail-closed path instead of comparing an unrelated transitive version.
    if (!references.has(crateName)) continue;
    const versions = allResolvedVersionsOf(normalized, crateName);
    const qualifiedVersion = references.get(crateName);
    if (qualifiedVersion) {
      // QNBS-v3 (cubic): a qualified reference not matched by any actual [[package]] entry means the lockfile itself is inconsistent — trust only a reference that a real resolved entry confirms.
      if (versions.includes(qualifiedVersion)) resolved.set(crateName, qualifiedVersion);
      else if (versions.length > 0) resolved.set(crateName, null);
      continue;
    }
    if (versions.length === 1) resolved.set(crateName, versions[0]);
    else if (versions.length > 1) resolved.set(crateName, null);
  }
  return resolved;
}

function importerHeaderName(line) {
  const match = line.match(/^ {2}(\S.*):$/);
  return match ? match[1] : null;
}

function importerPackageName(line) {
  const match = line.match(/^ {6}'?(@[\w.-]+\/[\w.-]+|[\w.-]+)'?:$/);
  return match ? match[1] : null;
}

function importerPackageVersion(line) {
  const match = line.match(/^ {8}version: (.+)$/);
  return match ? match[1].trim() : null;
}

// QNBS-v3: line-based state-machine parse (importer header at 2-space indent, package name at 6-space, specifier/version at 8-space) — pnpm-lock.yaml's importers block is regular enough that this avoids adding a YAML-parsing dependency.
export function resolvedPnpmImporterVersions(pnpmLock) {
  const lines = normalizeLineEndings(pnpmLock).split('\n');
  const byImporter = new Map();
  let currentImporter = null;
  let currentPackage = null;
  for (const line of lines) {
    const importer = importerHeaderName(line);
    if (importer) {
      currentImporter = importer;
      currentPackage = null;
      if (!byImporter.has(importer)) byImporter.set(importer, new Map());
      continue;
    }
    const packageName = importerPackageName(line);
    if (packageName) {
      currentPackage = packageName;
      continue;
    }
    const version = importerPackageVersion(line);
    if (!version) continue;
    if (!currentImporter) continue;
    if (!currentPackage) continue;
    byImporter.get(currentImporter).set(currentPackage, version);
  }
  return byImporter;
}

// QNBS-v3: reads package.json for every workspace member from disk — kept separate from the pure comparison function below so that one stays fully unit-testable without touching the filesystem.
function discoverWorkspaceImporterPackages() {
  const importerPackages = [
    { importer: '.', pkg: JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) },
  ];
  if (!fs.existsSync(packagesDir)) return importerPackages;
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) continue;
    importerPackages.push({
      importer: `packages/${entry.name}`,
      pkg: JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')),
    });
  }
  return importerPackages;
}

// QNBS-v3 (CodeScene): extracted so findTauriPluginVersionMismatches stays a flat loop — returns a finding string for one declared pair, or null when it's aligned.
function checkPluginPairParity(importer, crateName, cargoVersions, importerVersions) {
  const npmName = crateToNpmName(crateName);
  if (!cargoVersions.has(crateName)) {
    return `${importer}: ${npmName} is declared but ${crateName} has no resolved version in Cargo.lock — fix Cargo.lock before this check can validate parity`;
  }
  const rustVersion = cargoVersions.get(crateName);
  if (rustVersion === null) {
    return `${importer}: ${npmName} is declared but ${crateName} resolves to more than one version in Cargo.lock with no disambiguating direct-dependency reference — fix Cargo.lock before this check can validate parity`;
  }
  const npmVersion = importerVersions?.get(npmName);
  if (!npmVersion) {
    return `${importer}: ${npmName} is declared but has no resolved version in pnpm-lock.yaml for this importer — reconcile the lockfile before this check can validate parity`;
  }
  const rustMM = majorMinor(rustVersion);
  if (!rustMM)
    return `${importer}: ${crateName}'s resolved Rust version "${rustVersion}" is not a parseable semver`;
  const npmMM = majorMinor(npmVersion);
  if (!npmMM)
    return `${importer}: ${npmName}'s resolved npm version "${npmVersion}" is not a parseable semver`;
  if (rustMM !== npmMM) {
    return `${importer}: ${crateName} (Rust ${rustVersion}) vs ${npmName} (npm ${npmVersion}, resolved) — major.minor mismatch, "pnpm exec tauri build" rejects this`;
  }
  return null;
}

// QNBS-v3 (codex): a plugin declared under optionalDependencies/peerDependencies/devDependencies still resolves into the lockfile and can still be bundled — checking only "dependencies" silently skipped it.
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];

function isDeclaredInAnySection(pkg, npmName) {
  return DEPENDENCY_SECTIONS.some((section) => Boolean(pkg[section]?.[npmName]));
}

function declaredPluginCrateNames(pkg) {
  return PLUGIN_CRATE_NAMES.filter((crateName) =>
    isDeclaredInAnySection(pkg, crateToNpmName(crateName)),
  );
}

export function findTauriPluginVersionMismatches(cargoLock, pnpmLock, importerPackages) {
  const cargoVersions = resolvedCargoPluginVersions(cargoLock);
  const pnpmVersions = resolvedPnpmImporterVersions(pnpmLock);

  return importerPackages.flatMap(({ importer, pkg }) => {
    const importerVersions = pnpmVersions.get(importer);
    return declaredPluginCrateNames(pkg)
      .map((crateName) =>
        checkPluginPairParity(importer, crateName, cargoVersions, importerVersions),
      )
      .filter((finding) => finding !== null);
  });
}

function main() {
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  const pnpmLock = fs.readFileSync(pnpmLockPath, 'utf8');
  const importerPackages = discoverWorkspaceImporterPackages();
  const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, importerPackages);
  if (findings.length > 0) {
    process.stderr.write(
      `[tauri-plugin-versions] MISMATCH — ${findings.length} finding(s):\n${findings.map((f) => `  - ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `[tauri-plugin-versions] OK — ${importerPackages.length} workspace importer(s) checked against resolved lockfile versions, all major.minor-aligned.\n`,
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
