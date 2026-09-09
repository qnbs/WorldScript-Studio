#!/usr/bin/env node
/**
 * Verify each Tauri plugin's Rust crate (src-tauri/Cargo.lock) and coupled npm package
 * (package.json) share the same major.minor line.
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
const pkgPath = path.join(root, 'package.json');

// QNBS-v3: only Tauri plugins with a corresponding @tauri-apps/plugin-* npm package are coupled — tauri-plugin-log/window-state/deep-link/single-instance have no JS-side counterpart to drift against.
const PLUGIN_PAIRS = [
  ['tauri-plugin-dialog', '@tauri-apps/plugin-dialog'],
  ['tauri-plugin-fs', '@tauri-apps/plugin-fs'],
  ['tauri-plugin-http', '@tauri-apps/plugin-http'],
  ['tauri-plugin-notification', '@tauri-apps/plugin-notification'],
  ['tauri-plugin-process', '@tauri-apps/plugin-process'],
  ['tauri-plugin-shell', '@tauri-apps/plugin-shell'],
  ['tauri-plugin-updater', '@tauri-apps/plugin-updater'],
];

function resolvedCargoVersion(cargoLock, crateName) {
  const match = cargoLock.match(new RegExp(`name = "${crateName}"\\nversion = "([^"]+)"`));
  return match ? match[1] : null;
}

function majorMinor(version) {
  const match = version.match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : null;
}

export function findTauriPluginVersionMismatches(cargoLock, pkg) {
  const findings = [];
  for (const [crateName, npmName] of PLUGIN_PAIRS) {
    const rustVersion = resolvedCargoVersion(cargoLock, crateName);
    const npmRange = pkg.dependencies?.[npmName];
    if (!rustVersion || !npmRange) continue;
    const npmVersion = npmRange.replace(/^[\^~]/, '');
    if (majorMinor(rustVersion) !== majorMinor(npmVersion)) {
      findings.push(
        `${crateName} (Rust ${rustVersion}) vs ${npmName} (npm ${npmVersion}) — major/minor mismatch, "pnpm exec tauri build" rejects this`,
      );
    }
  }
  return findings;
}

function main() {
  const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const findings = findTauriPluginVersionMismatches(cargoLock, pkg);
  if (findings.length > 0) {
    process.stderr.write(
      `[tauri-plugin-versions] MISMATCH — ${findings.length} finding(s):\n${findings.map((f) => `  - ${f}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `[tauri-plugin-versions] OK — ${PLUGIN_PAIRS.length} plugin pairs checked, all major.minor-aligned.\n`,
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
