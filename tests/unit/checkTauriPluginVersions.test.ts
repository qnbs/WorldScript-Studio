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

function importerPkgWithSection(
  importer: string,
  section: 'optionalDependencies' | 'peerDependencies' | 'devDependencies',
  deps: Record<string, string>,
) {
  return { importer, pkg: { [section]: deps } };
}

describe('resolvedCargoPluginVersions', () => {
  it('resolves a plugin crate version from Cargo.lock', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http']) + cargoLockEntry('tauri-plugin-http', '2.6.0');
    const versions = resolvedCargoPluginVersions(cargoLock);
    expect(versions.get('tauri-plugin-http')).toBe('2.6.0');
  });

  // QNBS-v3: a Windows checkout without a pinned EOL for Cargo.lock can convert it to CRLF; the literal \n in the matcher must not silently stop matching.
  it('resolves a plugin crate version from a CRLF-line-ended Cargo.lock', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http']) + cargoLockEntry('tauri-plugin-http', '2.6.0');
    const versions = resolvedCargoPluginVersions(cargoLock.replace(/\n/g, '\r\n'));
    expect(versions.get('tauri-plugin-http')).toBe('2.6.0');
  });

  // QNBS-v3 (cubic): three ways the same two-entry duplicate Cargo.lock can be resolved, table-driven — a matching qualified reference disambiguates it, no reference at all is genuinely ambiguous, and a reference pointing nowhere real is an inconsistent lockfile. All three must fail closed except the first.
  it.each([
    {
      name: 'a qualified reference matching an existing entry',
      ref: 'tauri-plugin-http 2.6.0',
      expected: '2.6.0',
    },
    { name: 'no disambiguating reference at all', ref: 'tauri-plugin-http', expected: null },
    {
      name: 'a qualified reference matching no entry',
      ref: 'tauri-plugin-http 2.7.0',
      expected: null,
    },
  ])('resolves a duplicate-entry Cargo.lock correctly for $name', ({ ref, expected }) => {
    const cargoLock =
      ownPackageBlock([ref]) +
      cargoLockEntry('tauri-plugin-http', '2.5.0') + // transitive, textually first
      cargoLockEntry('tauri-plugin-http', '2.6.0'); // direct, referenced by name
    const versions = resolvedCargoPluginVersions(cargoLock);
    expect(versions.get('tauri-plugin-http') ?? null).toEqual(expected);
  });

  // QNBS-v3 (codex): a crate with only one lockfile entry is not necessarily a direct app dependency — it can be pulled in solely as a transitive of another plugin (e.g. tauri-plugin-deep-link via single-instance's "deep-link" feature). Absent from the direct-dependencies list, it must not be treated as resolved at all.
  it('does not resolve a crate that has only one lockfile entry but is absent from the direct-dependencies list', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-dialog']) + // http is NOT listed as a direct dependency here
      cargoLockEntry('tauri-plugin-http', '2.6.0'); // present only as a transitive occurrence
    const versions = resolvedCargoPluginVersions(cargoLock);
    expect(versions.has('tauri-plugin-http')).toBe(false);
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
    const cargoLock = ownPackageBlock([crate]) + cargoLockEntry(crate, rust);
    const pnpmLock = pnpmImporterBlock('.', { [npm]: { specifier, version: resolved } });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { [npm]: specifier }),
    ]);
    expect(findings).toEqual([]);
  });

  // QNBS-v3: reproduces the live v1.28.5 release-build failure — Rust bumped via a Dependabot PR without a matching npm bump, resolved lockfile versions included.
  it('flags a Rust-ahead-of-npm minor-version mismatch, reproducing the v1.28.5 release failure', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http', 'tauri-plugin-notification']) +
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
    // QNBS-v3: asserts the specific "major.minor mismatch" wording, not just the crate name — a weaker substring check on the crate name alone would also pass for the wrong reason (e.g. a "no resolved version" fail-closed finding also contains the crate name).
    expect(findings[0]).toContain('major.minor mismatch');
    expect(findings[0]).toContain('tauri-plugin-http');
    expect(findings[1]).toContain('major.minor mismatch');
    expect(findings[1]).toContain('tauri-plugin-notification');
  });

  // QNBS-v3: reproduces the exact reviewer-found gap — root package.json/lockfile were fixed, but a workspace member's own manifest still resolved the stale minor.
  it('flags a workspace-member importer drifting independently of the root', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-notification']) +
      cargoLockEntry('tauri-plugin-notification', '2.4.0');
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
    expect(findings[0]).toContain('major.minor mismatch');
    expect(findings[0]).toContain('packages/desktop-contracts');
    expect(findings[0]).toContain('@tauri-apps/plugin-notification');
  });

  // QNBS-v3 (codex): a crate resolved only transitively (absent from the direct-dependencies list) must fail closed through the full pipeline too, not just at the resolvedCargoPluginVersions level.
  it('fails closed end-to-end when the declared npm plugin has no direct Rust dependency, only a transitive one', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-dialog']) + cargoLockEntry('tauri-plugin-http', '2.6.0');
    const pnpmLock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.0' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkg('.', { '@tauri-apps/plugin-http': '^2.6.0' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('no resolved version in Cargo.lock');
  });

  // QNBS-v3 (codex): a plugin declared under optionalDependencies/peerDependencies/devDependencies still resolves into the lockfile and can still be bundled — checking only "dependencies" silently skipped it.
  it('checks a plugin declared under a non-"dependencies" section too', () => {
    const cargoLock =
      ownPackageBlock(['tauri-plugin-http']) + cargoLockEntry('tauri-plugin-http', '2.5.0');
    const pnpmLock = pnpmImporterBlock('.', {
      '@tauri-apps/plugin-http': { specifier: '^2.6.0', version: '2.6.0' },
    });
    const findings = findTauriPluginVersionMismatches(cargoLock, pnpmLock, [
      importerPkgWithSection('.', 'optionalDependencies', { '@tauri-apps/plugin-http': '^2.6.0' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('major.minor mismatch');
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
      ownPackageBlock(['tauri-plugin-http']) +
      cargoLockEntry('tauri-plugin-http', '2.5.0') +
      cargoLockEntry('tauri-plugin-http', '2.6.0');
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
      cargoLock:
        ownPackageBlock(['tauri-plugin-http']) + cargoLockEntry('tauri-plugin-http', '2.6.0'),
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
    const cargoLock =
      ownPackageBlock(['tauri-plugin-notification']) +
      cargoLockEntry('tauri-plugin-notification', '2.4.0');
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
