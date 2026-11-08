#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const PLATFORMS = ['linux-x86_64', 'windows-x86_64', 'darwin-aarch64'];

function releasePatterns(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    linuxDeb: new RegExp(`^WorldScript[ .]Studio_${escaped}_amd64\\.deb$`),
    linuxRpm: new RegExp(`^WorldScript[ .]Studio-${escaped}-1\\.x86_64\\.rpm$`),
    linuxAppImage: new RegExp(`^WorldScript[ .]Studio_${escaped}_amd64\\.AppImage$`),
    windowsSetup: new RegExp(`^WorldScript[ .]Studio_${escaped}_x64-setup\\.exe$`),
    windowsMsi: new RegExp(`^WorldScript[ .]Studio_${escaped}_x64_en-US\\.msi$`),
    macDmg: new RegExp(`^WorldScript[ .]Studio_${escaped}_aarch64\\.dmg$`),
    macUpdater: /^WorldScript[ .]Studio\.app\.tar\.gz$/,
    linuxSbom: new RegExp(`^worldscript-studio-${escaped}-x86_64-unknown-linux-gnu\\.cdx\\.json$`),
    linuxNotices: new RegExp(
      `^worldscript-studio-${escaped}-x86_64-unknown-linux-gnu\\.third-party-notices\\.txt$`,
    ),
    windowsSbom: new RegExp(`^worldscript-studio-${escaped}-x86_64-pc-windows-msvc\\.cdx\\.json$`),
    windowsNotices: new RegExp(
      `^worldscript-studio-${escaped}-x86_64-pc-windows-msvc\\.third-party-notices\\.txt$`,
    ),
    macSbom: new RegExp(`^worldscript-studio-${escaped}-aarch64-apple-darwin\\.cdx\\.json$`),
    macNotices: new RegExp(
      `^worldscript-studio-${escaped}-aarch64-apple-darwin\\.third-party-notices\\.txt$`,
    ),
  };
}

export function validateReleaseAssetNames(assetNames, version) {
  const errors = [];
  if (!RELEASE_VERSION.test(version)) {
    return { ok: false, errors: ['version must be a plain X.Y.Z release version'], selected: {} };
  }

  const names = assetNames.filter((name) => typeof name === 'string');
  const duplicateNames = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (duplicateNames.length) errors.push(`duplicate asset names: ${duplicateNames.join(', ')}`);

  const patterns = releasePatterns(version);
  const selected = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      errors.push(`${key}: expected exactly one matching asset, found ${matches.length}`);
    } else {
      selected[key] = matches[0];
    }
  }

  const required = new Set(Object.values(selected));
  const signedAssets = [
    selected.linuxDeb,
    selected.linuxRpm,
    selected.linuxAppImage,
    selected.windowsSetup,
    selected.windowsMsi,
    selected.macUpdater,
  ].filter(Boolean);
  for (const asset of signedAssets) required.add(`${asset}.sig`);

  for (const name of names) {
    if (!required.has(name)) errors.push(`unexpected release asset: ${name}`);
  }
  for (const name of required) {
    if (!names.includes(name)) errors.push(`missing release asset: ${name}`);
  }

  return { ok: errors.length === 0, errors, selected };
}

function validBase64(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

export function validateLatestManifest({ manifest, version, repository, assetNames, signatures }) {
  const errors = [];
  const assetCheck = validateReleaseAssetNames(assetNames, version);
  errors.push(...assetCheck.errors);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    errors.push('repository must be an owner/repository pair');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: [...errors, 'latest.json must contain an object'] };
  }
  if (manifest.version !== version) errors.push('latest.json version does not match the release');
  if (typeof manifest.notes !== 'string' || !manifest.notes.trim())
    errors.push('latest.json notes are missing');
  if (typeof manifest.pub_date !== 'string' || Number.isNaN(Date.parse(manifest.pub_date))) {
    errors.push('latest.json pub_date is missing or invalid');
  }

  const platformMap = {
    'linux-x86_64': ['linuxAppImage'],
    'windows-x86_64': ['windowsSetup'],
    'darwin-aarch64': ['macUpdater'],
  };
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    errors.push('latest.json platforms must be an object');
    return { ok: false, errors };
  }
  const actualPlatforms = Object.keys(platforms).sort();
  if (JSON.stringify(actualPlatforms) !== JSON.stringify([...PLATFORMS].sort())) {
    errors.push(`latest.json must contain exactly: ${PLATFORMS.join(', ')}`);
  }

  for (const [platform, [selectedKey]] of Object.entries(platformMap)) {
    const asset = assetCheck.selected[selectedKey];
    const entry = platforms[platform];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`latest.json is missing ${platform}`);
      continue;
    }
    const expectedUrl = asset
      ? `https://github.com/${repository}/releases/download/v${version}/${asset.replaceAll(' ', '.')}`
      : '';
    if (entry.url !== expectedUrl)
      errors.push(`${platform} URL does not target its required updater payload`);
    if (!validBase64(entry.signature)) errors.push(`${platform} signature is missing or malformed`);
    if (asset) {
      const sidecar = signatures?.[`${asset}.sig`]?.trim();
      if (!sidecar || entry.signature !== sidecar) {
        errors.push(`${platform} signature does not match the published updater sidecar`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateRemoteAssetRecords(localAssets, remoteAssets) {
  const errors = [];
  const expected = new Map(localAssets.map((asset) => [asset.name.replaceAll(' ', '.'), asset]));
  const actualNames = remoteAssets.map((asset) => asset.name);
  const duplicates = [
    ...new Set(actualNames.filter((name, index) => actualNames.indexOf(name) !== index)),
  ];
  if (duplicates.length) errors.push(`duplicate uploaded asset names: ${duplicates.join(', ')}`);

  const actual = new Map(remoteAssets.map((asset) => [asset.name, asset]));
  for (const [name, local] of expected) {
    const remote = actual.get(name);
    if (!remote) {
      errors.push(`uploaded release is missing ${name}`);
      continue;
    }
    if (Number(remote.size) !== Number(local.size))
      errors.push(`${name} uploaded size differs from the validated file`);
    if (remote.digest !== local.digest)
      errors.push(`${name} uploaded SHA-256 differs from the validated file`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) errors.push(`unexpected uploaded release asset: ${name}`);
  }
  return { ok: errors.length === 0, errors };
}

async function readAssetDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = [];
  for (const entry of entries) {
    if (!entry.isFile())
      throw new Error(`release asset directory contains a non-file entry: ${entry.name}`);
    const path = join(directory, entry.name);
    const metadata = await stat(path);
    if (metadata.size <= 0) throw new Error(`release asset is empty: ${entry.name}`);
    assets.push({
      name: entry.name,
      path,
      size: metadata.size,
      digest: `sha256:${createHash('sha256')
        .update(await readFile(path))
        .digest('hex')}`,
    });
  }
  return assets;
}

function report(result) {
  if (!result.ok) {
    for (const error of result.errors) console.error(`release gate: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('release asset gate passed');
}

async function main(args) {
  const [mode, version, directory, repository, inputFile] = args;
  if (!mode || !version || !directory) {
    throw new Error(
      'usage: release-assets-guard.mjs <assets|generate|validate|remote> <version> <asset-dir> [repository] [input-file]',
    );
  }
  const localAssets = await readAssetDirectory(directory);
  const names = localAssets.map((asset) => asset.name);
  const sidecars = Object.fromEntries(
    await Promise.all(
      names
        .filter((name) => name.endsWith('.sig'))
        .map(async (name) => [name, await readFile(join(directory, name), 'utf8')]),
    ),
  );

  if (mode === 'assets') {
    report(validateReleaseAssetNames(names, version));
    return;
  }
  if (mode === 'generate') {
    const assetCheck = validateReleaseAssetNames(names, version);
    if (!assetCheck.ok) return report(assetCheck);
    const { selected } = assetCheck;
    const pubDate = new Date().toISOString();
    const manifest = {
      version,
      notes: 'See release notes',
      pub_date: pubDate,
      platforms: {
        'linux-x86_64': {
          signature: sidecars[`${selected.linuxAppImage}.sig`]?.trim() ?? '',
          url: `https://github.com/${repository}/releases/download/v${version}/${selected.linuxAppImage.replaceAll(' ', '.')}`,
        },
        'windows-x86_64': {
          signature: sidecars[`${selected.windowsSetup}.sig`]?.trim() ?? '',
          url: `https://github.com/${repository}/releases/download/v${version}/${selected.windowsSetup.replaceAll(' ', '.')}`,
        },
        'darwin-aarch64': {
          signature: sidecars[`${selected.macUpdater}.sig`]?.trim() ?? '',
          url: `https://github.com/${repository}/releases/download/v${version}/${selected.macUpdater.replaceAll(' ', '.')}`,
        },
      },
    };
    const result = validateLatestManifest({
      manifest,
      version,
      repository,
      assetNames: names,
      signatures: sidecars,
    });
    if (!result.ok) return report(result);
    await writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log('generated and validated latest.json for all three signed updater platforms');
    return;
  }
  if (mode === 'validate') {
    const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
    const result = validateLatestManifest({
      manifest,
      version,
      repository,
      assetNames: names.filter((name) => name !== 'latest.json'),
      signatures: sidecars,
    });
    report(result);
    return;
  }
  if (mode === 'remote') {
    if (!inputFile) throw new Error('remote mode requires the paginated GitHub asset TSV path');
    const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
    const manifestCheck = validateLatestManifest({
      manifest,
      version,
      repository,
      assetNames: names.filter((name) => name !== 'latest.json'),
      signatures: sidecars,
    });
    if (!manifestCheck.ok) return report(manifestCheck);
    const remoteText = await readFile(inputFile, 'utf8');
    const remoteAssets = remoteText
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, size, digest] = line.split('\t');
        return { name, size: Number(size), digest };
      });
    const digestCheck =
      localAssets.filter(({ name }) => name === 'latest.json').length === 1 &&
      localAssets.every(({ digest }) => /^sha256:[0-9a-f]{64}$/.test(digest));
    if (!digestCheck)
      return report({
        ok: false,
        errors: ['local release package must include latest.json and SHA-256 digests'],
      });
    report(validateRemoteAssetRecords(localAssets, remoteAssets));
    return;
  }
  throw new Error(`unknown release gate mode: ${mode}`);
}

if (process.argv[1] && basename(process.argv[1]) === 'release-assets-guard.mjs') {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release gate: ${error.message}`);
    process.exitCode = 1;
  });
}
