#!/usr/bin/env node
/**
 * Wires apps/desktop-cef into a fetched CEF SDK's own build, by appending an
 * add_subdirectory() call to a *copy* of the SDK's root CMakeLists.txt — the exact
 * mechanism ADR-0020's spike proved works, reused here instead of reinventing CEF's
 * platform bootstrap (compiler/linker flags, OS_LINUX/PROJECT_ARCH detection) from a
 * from-scratch top-level CMakeLists.txt in this repo.
 *
 * Never mutates the fetched SDK in place — copies its root CMakeLists.txt into the
 * build directory first, so re-running scripts/cef/fetch-cef-sdk.mjs's cache-hit path
 * always sees the SDK exactly as extracted.
 *
 * Run: node scripts/cef/prepare-cef-build.mjs <extracted-cef-dir> <build-dir>
 * Prints the patched CMakeLists.txt's directory (the -S argument for `cmake`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

const [cefDir, buildDir] = process.argv.slice(2);
if (!cefDir || !buildDir) {
  console.error(
    '[prepare-cef-build] Usage: node scripts/cef/prepare-cef-build.mjs <extracted-cef-dir> <build-dir>',
  );
  process.exit(1);
}

const sourceCMakeListsPath = path.join(cefDir, 'CMakeLists.txt');
if (!fs.existsSync(sourceCMakeListsPath)) {
  console.error(`[prepare-cef-build] Not found: ${sourceCMakeListsPath}`);
  process.exit(1);
}

const cmakeSourceDir = path.join(buildDir, 'cmake-src');
fs.mkdirSync(cmakeSourceDir, { recursive: true });

// QNBS-v3: copies the whole extracted SDK's top level via symlinks for CEF's own subdirs, keeping only CMakeLists.txt as a real (patchable) file.
for (const entry of fs.readdirSync(cefDir, { withFileTypes: true })) {
  if (entry.name === 'CMakeLists.txt') continue;
  const target = path.join(cmakeSourceDir, entry.name);
  if (!fs.existsSync(target)) {
    fs.symlinkSync(path.join(cefDir, entry.name), target);
  }
}

const desktopCefAbsPath = path.join(repoRoot, 'apps', 'desktop-cef');
const originalCMakeLists = fs.readFileSync(sourceCMakeListsPath, 'utf8');
const patchedCMakeLists = `${originalCMakeLists}\nadd_subdirectory("${desktopCefAbsPath}" "\${CMAKE_BINARY_DIR}/worldscript_host")\n`;
fs.writeFileSync(path.join(cmakeSourceDir, 'CMakeLists.txt'), patchedCMakeLists);

console.log(`[prepare-cef-build] Patched CMakeLists.txt ready at ${cmakeSourceDir}`);
console.log(cmakeSourceDir);
