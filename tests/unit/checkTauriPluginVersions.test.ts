// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findTauriPluginVersionMismatches } from '../../scripts/check-tauri-plugin-versions.mjs';

function cargoLockEntry(crateName: string, version: string): string {
  return `[[package]]\nname = "${crateName}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
}

describe('findTauriPluginVersionMismatches', () => {
  it('reports nothing when every plugin pair shares the same major.minor', () => {
    const cargoLock = cargoLockEntry('tauri-plugin-http', '2.6.0');
    const pkg = { dependencies: { '@tauri-apps/plugin-http': '^2.6.3' } };
    expect(findTauriPluginVersionMismatches(cargoLock, pkg)).toEqual([]);
  });

  // QNBS-v3: reproduces the live v1.28.5 release-build failure — Rust bumped via a Dependabot PR without a matching npm bump.
  it('flags a Rust-ahead-of-npm minor-version mismatch, reproducing the v1.28.5 release failure', () => {
    const cargoLock =
      cargoLockEntry('tauri-plugin-http', '2.6.0') +
      cargoLockEntry('tauri-plugin-notification', '2.4.0');
    const pkg = {
      dependencies: {
        '@tauri-apps/plugin-http': '^2.5.9',
        '@tauri-apps/plugin-notification': '^2.3.3',
      },
    };
    const findings = findTauriPluginVersionMismatches(cargoLock, pkg);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain('tauri-plugin-http');
    expect(findings[1]).toContain('tauri-plugin-notification');
  });

  it('flags an npm-ahead-of-Rust minor-version mismatch too', () => {
    const cargoLock = cargoLockEntry('tauri-plugin-updater', '2.9.0');
    const pkg = { dependencies: { '@tauri-apps/plugin-updater': '^2.11.0' } };
    const findings = findTauriPluginVersionMismatches(cargoLock, pkg);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('tauri-plugin-updater');
  });

  it('ignores a plugin with no npm counterpart declared', () => {
    const cargoLock = cargoLockEntry('tauri-plugin-log', '2.7.0');
    const pkg = { dependencies: {} };
    expect(findTauriPluginVersionMismatches(cargoLock, pkg)).toEqual([]);
  });

  it('ignores an npm package with no resolved Rust crate in Cargo.lock', () => {
    const cargoLock = '';
    const pkg = { dependencies: { '@tauri-apps/plugin-http': '^2.6.0' } };
    expect(findTauriPluginVersionMismatches(cargoLock, pkg)).toEqual([]);
  });

  it('tolerates a patch-version difference within the same major.minor', () => {
    const cargoLock = cargoLockEntry('tauri-plugin-dialog', '2.7.1');
    const pkg = { dependencies: { '@tauri-apps/plugin-dialog': '^2.7.0' } };
    expect(findTauriPluginVersionMismatches(cargoLock, pkg)).toEqual([]);
  });
});
