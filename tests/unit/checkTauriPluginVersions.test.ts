// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  findTauriPluginVersionMismatches,
  resolvedCargoPluginVersions,
  resolvedPnpmImporterVersions,
} from '../../scripts/check-tauri-plugin-versions.mjs';

function cargoLockEntry(crateName: string, version: string): string {
  return `[[package]]\nname = "${crateName}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
}

// QNBS-v3: mirrors how Cargo.lock disambiguates a same-named dependency as "name version" inside the owning package's own dependencies list only when more than one resolved version exists.
function ownPackageBlock(dependencyRefs: string[]): string {
  const refLines = dependencyRefs.map((ref) => ` "${ref}",`).join('\n');
  return `[[package]]\nname = "worldscript-studio"\nversion = "1.28.5"\ndependencies = [\n${refLines}\n]\n`;
}

function pnpmImporterBlock(
  importer: string,
  pkgs: Record<string, { specifier: string; version: string }>,
): string {
  const lines = [`  ${importer}:`, '    dependencies:'];
  for (const [name, { specifier, version }] of Object.entries(pkgs)) {
    lines.push(
      `      '${name}':`,
      `        specifier: ${specifier}`,
      `        version: ${version}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function importerPkg(importer: string, dependencies: Record<string, string>) {
  return { importer, pkg: { dependencies } };
}

describe('resolvedCargoPluginVersions', () => {
  it('resolves a plugin crate version from Cargo.lock', () => {
    const versions = resolvedCargoPluginVersions(cargoLockEntry('tauri-plugin-http', '2.6.0'));
    expect(versions.get('tauri-plugin-http')).toBe('2.6.0');
  });

  // QNBS-v3: a Windows checkout without a pinned EOL for Cargo.lock can convert it to CRLF; the literal \n in the matcher must not silently stop matching.
  it('resolves a plugin crate version from a CRLF-line-ended Cargo.lock', () => {
    const crlf = cargoLockEntry('tauri-plugin-http', '2.6.0').replace(/\n/g, '\r\n');
    const versions = resolvedCargoPluginVersions(crlf);
    expect(versions.get('tauri-plugin-http')).toBe('2.6.0');
  });

  // QNBS-v3 (cubic): reproduces the reviewer-found gap — a first-match lookup over duplicate package entries could silently pick a transitive occurrence instead of the direct app dependency Cargo.lock itself disambiguates.
  it('resolves the direct-dependency version, not the textually-first one, when Cargo.lock has duplicate entries', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http 2.6.0']) +
      cargoLockEntry('tauri-plugin-http', '2.5.0') + // transitive, textually first
      cargoLockEntry('tauri-plugin-http', '2.6.0'); // direct, referenced by name
    const versions = resolvedCargoPluginVersions(cargoLock);
    expect(versions.get('tauri-plugin-http')).toBe('2.6.0');
  });

  it('fails closed (null) when a crate resolves to more than one version with no disambiguating reference', () => {
    const cargoLock =
      cargoLockEntry('tauri-plugin-http', '2.5.0') + cargoLockEntry('tauri-plugin-http', '2.6.0');
    const versions = resolvedCargoPluginVersions(cargoLock);
    expect(versions.get('tauri-plugin-http')).toBeNull();
  });
});

describe('resolvedPnpmImporterVersions', () => {
  it('resolves the actual locked version, not the declared specifier range', () => {
    const lock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.3' },
    });
    const byImporter = resolvedPnpmImporterVersions(lock);
    expect(byImporter.get('.')?.get('@tauri-apps/plugin-http')).toBe('2.6.3');
  });

  it('keeps each importer’s resolved versions independent', () => {
    const lock =
      pnpmImporterBlock('.', {
        '@tauri-apps/plugin-notification': { specifier: '^2.4.0', version: '2.4.0' },
      }) +
      pnpmImporterBlock('packages/desktop-contracts', {
        '@tauri-apps/plugin-notification': { specifier: '^2.3.3', version: '2.3.3' },
      });
    const byImporter = resolvedPnpmImporterVersions(lock);
    expect(byImporter.get('.')?.get('@tauri-apps/plugin-notification')).toBe('2.4.0');
    expect(
      byImporter.get('packages/desktop-contracts')?.get('@tauri-apps/plugin-notification'),
    ).toBe('2.3.3');
  });
});

describe('findTauriPluginVersionMismatches', () => {
  // QNBS-v3: consolidates two previously-separate "no finding" cases (a straightforwardly aligned pair, and a resolved version that has moved past its declared specifier) into one table.
  it.each([
    {
      name: 'an aligned pair',
      crate: 'tauri-plugin-http',
      rust: '2.6.0',
      npm: '@tauri-apps/plugin-http',
      specifier: '^2.6.0',
      resolved: '2.6.3',
    },
    {
      name: 'a resolved version ahead of its specifier',
      crate: 'tauri-plugin-updater',
      rust: '2.11.0',
      npm: '@tauri-apps/plugin-updater',
      specifier: '^2.9.0',
      resolved: '2.11.4',
    },
  ])('reports nothing for $name', ({ crate, rust, npm, specifier, resolved }) => {
    const cargoLock = cargoLockEntry(crate, rust);
    const pnpmLock = pnpmImporterBlock('.', { [npm]: { specifier, version: resolved } });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { [npm]: specifier }),
    ]);
    expect(findings).toEqual([]);
  });

  // QNBS-v3: reproduces the live v1.28.5 release-build failure — Rust bumped via a Dependabot PR without a matching npm bump, resolved lockfile versions included.
  it('flags a Rust-ahead-of-npm minor-version mismatch, reproducing the v1.28.5 release failure', () => {
    const cargoLock =
      cargoLockEntry('tauri-plugin-http', '2.6.0') +
      cargoLockEntry('tauri-plugin-notification', '2.4.0');
    const pnpmLock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.5.9', version: '2.5.9' },
      '@tauri-apps/plugin-notification': { specifier: '^2.3.3', version: '2.3.3' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', {
        '@tauri-apps/plugin-http': '^2.5.9',
        '@tauri-apps/plugin-notification': '^2.3.3',
      }),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain('tauri-plugin-http');
    expect(findings[1]).toContain('tauri-plugin-notification');
  });

  // QNBS-v3: reproduces the exact reviewer-found gap — root package.json/lockfile were fixed, but a workspace member's own manifest still resolved the stale minor.
  it('flags a workspace-member importer drifting independently of the root', () => {
    const cargoLock = cargoLockEntry('tauri-plugin-notification', '2.4.0');
    const pnpmLock =
      pnpmImporterBlock('.', {
        '@tauri-apps/plugin-notification': { specifier: '^2.4.0', version: '2.4.0' },
      }) +
      pnpmImporterBlock('packages/desktop-contracts', {
        '@tauri-apps/plugin-notification': { specifier: '^2.3.3', version: '2.3.3' },
      });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { '@tauri-apps/plugin-notification': '^2.4.0' }),
      importerPkg('packages/desktop-contracts', { '@tauri-apps/plugin-notification': '^2.3.3' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('packages/desktop-contracts');
    expect(findings[0]).toContain('@tauri-apps/plugin-notification');
  });

  // QNBS-v3 (cubic): a duplicate Cargo.lock entry must resolve to the direct app dependency's version (2.6.0), never the textually-first transitive occurrence (2.5.0) — proven by the fact that using the wrong one would falsely flag this as a mismatch.
  it('does not mistake a transitive crate version for the direct app dependency', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http 2.6.0']) +
      cargoLockEntry('tauri-plugin-http', '2.5.0') +
      cargoLockEntry('tauri-plugin-http', '2.6.0');
    const pnpmLock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.3' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { '@tauri-apps/plugin-http': '^2.6.0' }),
    ]);
    expect(findings).toEqual([]);
  });

  it('fails closed when Cargo.lock has an undisambiguated duplicate, rather than guessing', () => {
    const cargoLock =
      cargoLockEntry('tauri-plugin-http', '2.5.0') + cargoLockEntry('tauri-plugin-http', '2.6.0');
    const pnpmLock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.3' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { '@tauri-apps/plugin-http': '^2.6.0' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('more than one version');
  });

  // QNBS-v3: fail closed — a plugin declared in package.json with no resolved Cargo.lock or pnpm-lock.yaml entry means a lockfile is out of sync and parity cannot be verified, which must surface as a finding, not a silent pass.
  it.each([
    {
      name: 'no resolved Rust crate version',
      cargoLock: '', // no tauri-plugin-http entry at all
      pnpmLock: pnpmImporterBlock('.', {
        '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.0' },
      }),
      expectedSubstring: 'no resolved version in Cargo.lock',
    },
    {
      name: 'no resolved npm version in the lockfile',
      cargoLock: cargoLockEntry('tauri-plugin-http', '2.6.0'),
      pnpmLock: pnpmImporterBlock('.', {}), // http declared in package.json but absent from the lockfile importer
      expectedSubstring: 'no resolved version in pnpm-lock.yaml',
    },
  ])(
    'fails closed when a declared plugin has $name',
    ({ cargoLock, pnpmLock, expectedSubstring }) => {
      const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
        importerPkg('.', { '@tauri-apps/plugin-http': '^2.6.0' }),
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain(expectedSubstring);
    },
  );

  it('skips a plugin the importer does not declare at all (not applicable, not a failure)', () => {
    // QNBS-v3: http has no Cargo.lock entry at all here, proving it was never even considered for an importer that doesn't declare it — only notification (declared, and given a matching Cargo entry) is checked.
    const cargoLock = cargoLockEntry('tauri-plugin-notification', '2.4.0');
    const pnpmLock = pnpmImporterBlock('packages/desktop-contracts', {
      '@tauri-apps/plugin-notification': { specifier: '^2.4.0', version: '2.4.0' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('packages/desktop-contracts', {
        '@tauri-apps/plugin-notification': '^2.4.0',
      }),
    ]);
    expect(findings).toEqual([]);
  });
});
