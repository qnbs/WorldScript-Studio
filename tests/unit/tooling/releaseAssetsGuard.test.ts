import { describe, expect, it } from 'vitest';
import {
  parseRemoteAssetRecords,
  validateLatestManifest,
  validateReleaseAssetNames,
  validateRemoteAssetRecords,
} from '../../../scripts/release-assets-guard.mjs';

const version = '1.29.3';
const repository = 'qnbs/WorldScript-Studio';
const installers = [
  `WorldScript Studio_${version}_amd64.deb`,
  `WorldScript Studio-${version}-1.x86_64.rpm`,
  `WorldScript Studio_${version}_amd64.AppImage`,
  `WorldScript Studio_${version}_x64-setup.exe`,
  `WorldScript Studio_${version}_x64_en-US.msi`,
  `WorldScript Studio_${version}_aarch64.dmg`,
  'WorldScript Studio.app.tar.gz',
] as const;
const inventories = [
  'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
  'aarch64-apple-darwin',
].flatMap((target) => [
  `worldscript-studio-${version}-${target}.cdx.json`,
  `worldscript-studio-${version}-${target}.third-party-notices.txt`,
]);
const signed = [
  installers[0],
  installers[1],
  installers[2],
  installers[3],
  installers[4],
  installers[6],
];
const completeAssets = [...installers, ...signed.map((name) => `${name}.sig`), ...inventories];
const signatures = Object.fromEntries(signed.map((name) => [`${name}.sig`, 'c2lnbmF0dXJl']));

function manifest() {
  return {
    version,
    notes: 'See release notes',
    pub_date: '2026-11-08T12:00:00Z',
    platforms: {
      'linux-x86_64': {
        signature: signatures[`${installers[2]}.sig`],
        url: `https://github.com/${repository}/releases/download/v${version}/${installers[2].replaceAll(' ', '.')}`,
      },
      'windows-x86_64': {
        signature: signatures[`${installers[3]}.sig`],
        url: `https://github.com/${repository}/releases/download/v${version}/${installers[3].replaceAll(' ', '.')}`,
      },
      'darwin-aarch64': {
        signature: signatures[`${installers[6]}.sig`],
        url: `https://github.com/${repository}/releases/download/v${version}/${installers[6].replaceAll(' ', '.')}`,
      },
    },
  };
}

describe('release asset completeness gate', () => {
  it('accepts the complete Linux, Windows, and macOS ARM installer and notice matrix', () => {
    const result = validateReleaseAssetNames(completeAssets, version);
    expect(result.ok).toBe(true);
    expect(result.selected.macUpdater).toBe(installers[6]);
  });

  it.each(completeAssets)('rejects a missing required asset: %s', (missing) => {
    const result = validateReleaseAssetNames(
      completeAssets.filter((name) => name !== missing),
      version,
    );
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate, wrong-version, and unsupported-architecture artifacts', () => {
    expect(validateReleaseAssetNames([...completeAssets, installers[0]], version).ok).toBe(false);
    expect(
      validateReleaseAssetNames(
        completeAssets.map((name) => name.replace(version, '1.29.2')),
        version,
      ).ok,
    ).toBe(false);
    expect(
      validateReleaseAssetNames([...completeAssets, 'WorldScript Studio_1.29.3_x64.dmg'], version)
        .ok,
    ).toBe(false);
  });
});

describe('signed updater manifest gate', () => {
  const valid = () =>
    validateLatestManifest({
      manifest: manifest(),
      version,
      repository,
      assetNames: completeAssets,
      signatures,
    });

  it('requires all three exact release platforms and sidecar-matching signatures', () => {
    expect(valid().ok).toBe(true);
    const missingPlatform = manifest();
    const partialPlatforms = { ...missingPlatform.platforms } as Record<string, unknown>;
    delete partialPlatforms['darwin-aarch64'];
    expect(
      validateLatestManifest({
        manifest: { ...missingPlatform, platforms: partialPlatforms },
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
    const wrongSignature = manifest();
    wrongSignature.platforms['windows-x86_64'].signature = 'd3Jvbmc=';
    expect(
      validateLatestManifest({
        manifest: wrongSignature,
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
  });

  it('rejects stale version, wrong payload URL, malformed signature, and extra platform entries', () => {
    const stale = manifest();
    stale.version = '1.29.2';
    expect(
      validateLatestManifest({
        manifest: stale,
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
    const wrongUrl = manifest();
    wrongUrl.platforms['linux-x86_64'].url = 'https://example.invalid/unrelated.AppImage';
    expect(
      validateLatestManifest({
        manifest: wrongUrl,
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
    const malformed = manifest();
    malformed.platforms['darwin-aarch64'].signature = '';
    expect(
      validateLatestManifest({
        manifest: malformed,
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
    const extraPlatform = manifest();
    const unsupportedPlatforms = { ...extraPlatform.platforms } as Record<string, unknown>;
    unsupportedPlatforms['darwin-x86_64'] = extraPlatform.platforms['darwin-aarch64'];
    expect(
      validateLatestManifest({
        manifest: { ...extraPlatform, platforms: unsupportedPlatforms },
        version,
        repository,
        assetNames: completeAssets,
        signatures,
      }).ok,
    ).toBe(false);
  });
});

describe('uploaded release asset verification', () => {
  it('requires the uploaded inventory and SHA-256 digests to match the validated local files', () => {
    const localAsset = { name: 'latest.json', size: 32, digest: `sha256:${'a'.repeat(64)}` };
    const local = [localAsset];
    expect(parseRemoteAssetRecords(`latest.json\t32\t${localAsset.digest}`)).toEqual([
      { name: 'latest.json', size: 32, digest: localAsset.digest },
    ]);
    expect(() => parseRemoteAssetRecords('latest.json\tNaN\tsha256:invalid')).toThrow(
      'non-integer asset size',
    );
    expect(() => parseRemoteAssetRecords('latest.json\t32\t')).toThrow(
      'missing or has an invalid SHA-256 digest',
    );
    expect(
      validateRemoteAssetRecords(local, [
        { name: 'latest.json', size: 32, digest: localAsset.digest },
      ]).ok,
    ).toBe(true);
    expect(validateRemoteAssetRecords(local, []).ok).toBe(false);
    expect(
      validateRemoteAssetRecords(local, [
        { name: 'latest.json', size: 33, digest: localAsset.digest },
      ]).ok,
    ).toBe(false);
    expect(
      validateRemoteAssetRecords(local, [
        { name: 'latest.json', size: 32, digest: `sha256:${'b'.repeat(64)}` },
      ]).ok,
    ).toBe(false);
    expect(
      validateRemoteAssetRecords(local, [{ name: 'latest.json', size: 32, digest: '' }]).errors,
    ).toContain('latest.json uploaded SHA-256 digest is missing or invalid');
    expect(
      validateRemoteAssetRecords(local, [
        { name: 'latest.json', size: 32, digest: localAsset.digest },
        { name: 'unexpected.bin', size: 1, digest: `sha256:${'c'.repeat(64)}` },
      ]).ok,
    ).toBe(false);
  });
});
