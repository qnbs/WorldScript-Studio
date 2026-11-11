import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseRemoteAssetRecords,
  signedUpdaterVersion,
  validateLatestManifest,
  validateReleaseAssetNames,
  validateRemoteAssetRecords,
} from '../../../scripts/release-assets-guard.mjs';

const version = '1.29.3';
const repository = 'qnbs/WorldScript-Studio';
const releaseAssetGuardPath = resolve(process.cwd(), 'scripts/release-assets-guard.mjs');
const installers = [
  `WorldScript Studio_${version}_amd64.deb`,
  `WorldScript Studio-${version}-1.x86_64.rpm`,
  `WorldScript Studio_${version}_amd64.AppImage`,
  `WorldScript Studio_${version}_x64-setup.exe`,
  `WorldScript Studio_${version}_x64_en-US.msi`,
  `WorldScript Studio_${version}_aarch64.dmg`,
  'WorldScript Studio.app.tar.gz',
  `WorldScript Studio_${version}_x64.dmg`,
  'WorldScript Studio_x64.app.tar.gz',
] as const;
const inventories = [
  'x86_64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
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
  installers[8],
];
const completeAssets = [...installers, ...signed.map((name) => `${name}.sig`), ...inventories];
// A minisign signature file as the Tauri signer writes it, base64-encoded like the `.sig` sidecar.
const minisign = (trustedComment: string) =>
  Buffer.from(
    `untrusted comment: signature from tauri secret key\nUlVUcQ==\ntrusted comment: ${trustedComment}\nZ2xvYmFs\n`,
  ).toString('base64');
const boundSignature = (file: string, signedVersion: string = version) =>
  minisign(`timestamp:1794378809\tfile:${file}\tversion:${signedVersion}`);
const signatures = Object.fromEntries(signed.map((name) => [`${name}.sig`, boundSignature(name)]));
// Real public updater signatures: WorldScript.Studio_<v>_amd64.AppImage.sig of the v1.29.5 and v1.29.2 releases.
const REAL_SIGNATURE_1_29_5 =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUcUNTeGZzY2laYWdtNUhZNTlIUFVtRHBscThyTGxuVHl2aWRDZVQwTWEyZFJ4aWl4RTJpK2tidEZUcDVWVVFhZFlyalRhSGJ4K084c1N6akllLy9seWw4OHdKNXBwN0E0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0Mzc4ODA5CWZpbGU6V29ybGRTY3JpcHQgU3R1ZGlvXzEuMjkuNV9hbWQ2NC5BcHBJbWFnZQl2ZXJzaW9uOjEuMjkuNQpTUUhUY0MvZEEvN0R4eXBLQThPcUxBQXZ4SnRYU3JNazVTOFNNS0hYcnNMS0FLMkRoMFNWa0NqNXFNMzh0b25qeDNVNU9VUksyajZuRzg5eWU1eEdEZz09Cg==';
const REAL_SIGNATURE_1_29_2 =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUcUNTeGZzY2laYXNpOGVLY1lJaU0rZWhsNGV4blBEVEZrb1FuSnBZZ1RPTUlETmN2MnRUaGlTQk1TbG9ReEk4OVh3VThCUDhzRVNKWld3eEJJdWl6UmVtVWJyVHVGOUFvPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyNjgwNzIzCWZpbGU6V29ybGRTY3JpcHQgU3R1ZGlvXzEuMjkuMl9hbWQ2NC5BcHBJbWFnZQoxalpSRnR6cVQvU0t6dEMzWHBkMDJHWkt1Y2tyVWxBZG92N0krS3JmYjIva1RnSEIyRjZZNnV3WXVNYkErQmtRWnpwak45WDdLUVpGWVZ4a3NNbkhCUT09Cg==';

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
      'darwin-x86_64': {
        signature: signatures[`${installers[8]}.sig`],
        url: `https://github.com/${repository}/releases/download/v${version}/${installers[8].replaceAll(' ', '.')}`,
      },
    },
  };
}

describe('release asset completeness gate', () => {
  it('accepts the complete Linux, Windows, macOS ARM and macOS Intel installer and notice matrix', () => {
    const result = validateReleaseAssetNames(completeAssets, version);
    expect(result.ok).toBe(true);
    expect(result.selected.macUpdater).toBe(installers[6]);
    expect(result.selected.macIntelUpdater).toBe(installers[8]);
    expect(result.selected.macIntelDmg).toBe(installers[7]);
  });

  it('rejects an Intel payload that kept the Apple Silicon name', () => {
    const collided = completeAssets.filter((name) => !name.startsWith(installers[8]));
    const result = validateReleaseAssetNames([...collided, `${installers[6]}`], version);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'macIntelUpdater: expected exactly one matching asset, found 0',
    );
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

describe('release asset gate CLI dispatch', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty'])(
    'rejects inherited property mode %s instead of treating it as a handler',
    (mode) => {
      const result = spawnSync(
        process.execPath,
        [releaseAssetGuardPath, mode, version, '.', repository],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`unknown release gate mode: ${mode}`);
    },
  );
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
    unsupportedPlatforms['linux-aarch64'] = extraPlatform.platforms['linux-x86_64'];
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

describe('signed version binding (#1215)', () => {
  it('reads the bound version from real release signatures the way the client does', () => {
    expect(signedUpdaterVersion(REAL_SIGNATURE_1_29_5)).toBe('1.29.5');
    expect(signedUpdaterVersion(REAL_SIGNATURE_1_29_2)).toBeNull();
  });

  it('reads only the tab-separated version field of the trusted comment line', () => {
    expect(signedUpdaterVersion(minisign('timestamp:1\tfile:a\tversion:1.2.3'))).toBe('1.2.3');
    expect(signedUpdaterVersion(minisign('timestamp:1 file:a version:1.2.3'))).toBeNull();
    const untrustedOnly = Buffer.from(
      'untrusted comment: version:1.2.3\nUlVUcQ==\ntrusted comment: timestamp:1\nZ2xvYmFs\n',
    ).toString('base64');
    expect(signedUpdaterVersion(untrustedOnly)).toBeNull();
    const crlf = Buffer.from(
      'untrusted comment: x\r\nUlVUcQ==\r\ntrusted comment: timestamp:1\tversion:1.2.3\r\nZ2xvYmFs\r\n',
    ).toString('base64');
    expect(signedUpdaterVersion(crlf)).toBe('1.2.3');
    expect(signedUpdaterVersion('not base64!')).toBeNull();
    expect(signedUpdaterVersion(undefined)).toBeNull();
  });

  it('rejects a manifest whose updater signature binds no version or another version', () => {
    const unbound = minisign(`timestamp:1\tfile:${installers[2]}`);
    const otherVersion = boundSignature(installers[3], '1.29.2');
    const changed = manifest();
    changed.platforms['linux-x86_64'].signature = unbound;
    changed.platforms['windows-x86_64'].signature = otherVersion;
    const result = validateLatestManifest({
      manifest: changed,
      version,
      repository,
      assetNames: completeAssets,
      signatures: {
        ...signatures,
        [`${installers[2]}.sig`]: unbound,
        [`${installers[3]}.sig`]: otherVersion,
      },
    });
    expect(result.errors).toEqual([
      `linux-x86_64 signature does not bind version ${version} (signed: none)`,
      `windows-x86_64 signature does not bind version ${version} (signed: 1.29.2)`,
    ]);
  });

  it('accepts a v-prefixed signed version, as the client does', () => {
    const prefixed = boundSignature(installers[6], `v${version}`);
    const changed = manifest();
    changed.platforms['darwin-aarch64'].signature = prefixed;
    const result = validateLatestManifest({
      manifest: changed,
      version,
      repository,
      assetNames: completeAssets,
      signatures: { ...signatures, [`${installers[6]}.sig`]: prefixed },
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });
});

describe('uploaded release asset verification', () => {
  it('rejects a published inventory that omits any member of the complete asset matrix', () => {
    const localAssets = [...completeAssets, 'latest.json'].map((name, index) => ({
      name,
      size: index + 1,
      digest: `sha256:${String(index + 1).padStart(64, '0')}`,
    }));
    const uploadedAssets = localAssets.map((asset) => ({
      ...asset,
      name: asset.name.replaceAll(' ', '.'),
    }));

    expect(validateRemoteAssetRecords(localAssets, uploadedAssets).ok).toBe(true);
    expect(
      validateRemoteAssetRecords(
        localAssets,
        uploadedAssets.filter((asset) => asset.name !== 'WorldScript.Studio_1.29.3_amd64.deb'),
      ).ok,
    ).toBe(false);
  });

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
