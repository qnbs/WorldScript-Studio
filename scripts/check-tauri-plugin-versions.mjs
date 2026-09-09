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

// QNBS-v3: only Tauri plugins with a corresponding @tauri-apps/plugin-* npm package are coupled — tauri-plugin-log/window-state/deep-link/single-instance have no JS-side counterpart to drift against.
const PLUGIN_CRATE_NAMES = [
  'tauri-plugin-dialog',
  'tauri-plugin-fs',
  'tauri-plugin-http',
  'tauri-plugin-notification',
  'tauri-plugin-process',
  'tauri-plugin-shell',
  'tauri-plugin-updater',
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

export function resolvedCargoPluginVersions(cargoLock) {
  const normalized = normalizeLineEndings(cargoLock);
  const versions = new Map();
  for (const crateName of PLUGIN_CRATE_NAMES) {
    const match = normalized.match(new RegExp(`name = "${crateName}"\\nversion = "([^"]+)"`));
    if (match) versions.set(crateName, match[1]);
  }
  return versions;
}

// QNBS-v3: line-based state-machine parse (importer header at 2-space indent, package name at 6-space, specifier/version at 8-space) — pnpm-lock.yaml's importers block is regular enough that this avoids adding a YAML-parsing dependency.
export function resolvedPnpmImporterVersions(pnpmLock) {
  const normalized = normalizeLineEndings(pnpmLock);
  const lines = normalized.split('\n');
  const byImporter = new Map();
  let currentImporter = null;
  let currentPackage = null;
  for (const line of lines) {
    const importerMatch = line.match(/^ {2}(\S.*):$/);
    if (importerMatch && !line.startsWith('    ')) {
      currentImporter = importerMatch[1];
      currentPackage = null;
      if (!byImporter.has(currentImporter)) byImporter.set(currentImporter, new Map());
      continue;
    }
    const packageMatch = line.match(/^ {6}'?(@[\w.-]+\/[\w.-]+|[\w.-]+)'?:$/);
    if (packageMatch) {
      currentPackage = packageMatch[1];
      continue;
    }
    const versionMatch = line.match(/^ {8}version: (.+)$/);
    if (versionMatch && currentImporter && currentPackage) {
      byImporter.get(currentImporter).set(currentPackage, versionMatch[1].trim());
    }
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
  const rustVersion = cargoVersions.get(crateName);
  if (!rustVersion) {
    return `${importer}: ${npmName} is declared but ${crateName} has no resolved version in Cargo.lock — fix Cargo.lock before this check can validate parity`;
  }
  const npmVersion = importerVersions?.get(npmName);
  if (!npmVersion) {
    return `${importer}: ${npmName} is declared but has no resolved version in pnpm-lock.yaml for this importer — reconcile the lockfile before this check can validate parity`;
  }
  const rustMM = majorMinor(rustVersion);
  const npmMM = majorMinor(npmVersion);
  if (!rustMM || !npmMM || rustMM !== npmMM) {
    return `${importer}: ${crateName} (Rust ${rustVersion}) vs ${npmName} (npm ${npmVersion}, resolved) — major.minor mismatch, "pnpm exec tauri build" rejects this`;
  }
  return null;
}

function declaredPluginCrateNames(pkg) {
  return PLUGIN_CRATE_NAMES.filter((crateName) =>
    Boolean(pkg.dependencies?.[crateToNpmName(crateName)]),
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
