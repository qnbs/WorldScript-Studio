#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const PLATFORMS = ['linux-x86_64', 'windows-x86_64', 'darwin-aarch64', 'darwin-x86_64'];
const SIGNED_ASSET_KEYS = [
  'linuxDeb',
  'linuxRpm',
  'linuxAppImage',
  'windowsSetup',
  'windowsMsi',
  'macUpdater',
  'macIntelUpdater',
];
const PLATFORM_ASSETS = [
  ['linux-x86_64', 'linuxAppImage'],
  ['windows-x86_64', 'windowsSetup'],
  ['darwin-aarch64', 'macUpdater'],
  ['darwin-x86_64', 'macIntelUpdater'],
];

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
    // #507: the Intel leg renames its payload, which Tauri names like the Apple Silicon one, before upload.
    macIntelDmg: new RegExp(`^WorldScript[ .]Studio_${escaped}_x64\\.dmg$`),
    macIntelUpdater: /^WorldScript[ .]Studio_x64\.app\.tar\.gz$/,
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
    macIntelSbom: new RegExp(`^worldscript-studio-${escaped}-x86_64-apple-darwin\\.cdx\\.json$`),
    macIntelNotices: new RegExp(
      `^worldscript-studio-${escaped}-x86_64-apple-darwin\\.third-party-notices\\.txt$`,
    ),
  };
}

function duplicateNames(names) {
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

function selectExpectedAssets(names, patterns, errors) {
  const selected = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = names.filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      errors.push(`${key}: expected exactly one matching asset, found ${matches.length}`);
      continue;
    }
    selected[key] = matches[0];
  }
  return selected;
}

function requiredAssetNames(selected) {
  const required = new Set(Object.values(selected));
  for (const key of SIGNED_ASSET_KEYS) {
    const asset = selected[key];
    if (asset) required.add(`${asset}.sig`);
  }
  return required;
}

function reportMissingAndUnexpected(names, required, errors) {
  const knownNames = new Set(names);
  const unexpected = names.filter((name) => !required.has(name));
  const missing = [...required].filter((name) => !knownNames.has(name));
  for (const name of unexpected) errors.push(`unexpected release asset: ${name}`);
  for (const name of missing) errors.push(`missing release asset: ${name}`);
}

export function validateReleaseAssetNames(assetNames, version) {
  if (!RELEASE_VERSION.test(version)) {
    return { ok: false, errors: ['version must be a plain X.Y.Z release version'], selected: {} };
  }

  const names = assetNames.filter((name) => typeof name === 'string');
  const errors = duplicateNames(names).map((name) => `duplicate asset names: ${name}`);
  const selected = selectExpectedAssets(names, releasePatterns(version), errors);
  reportMissingAndUnexpected(names, requiredAssetNames(selected), errors);
  return { ok: errors.length === 0, errors, selected };
}

function isObjectRecord(value) {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  return !Array.isArray(value);
}

function hasBase64Shape(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function validBase64(value) {
  if (!hasBase64Shape(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

const TRUSTED_COMMENT_PREFIX = 'trusted comment: ';

/**
 * The version an updater signature binds, read the way the shipped client reads it (#1215):
 * minisign-verify 0.3.0 takes the third line of the decoded signature as the trusted comment
 * (`trusted comment: ` prefix, lines split like Rust `str::lines`), and tauri-plugin-updater 2.14.1
 * takes the first tab-separated `version:` field. Returns null when the signature binds none.
 */
export function signedUpdaterVersion(signature) {
  if (!validBase64(signature)) return null;
  const lines = Buffer.from(signature, 'base64')
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
  const trusted = lines[2];
  if (!trusted?.startsWith(TRUSTED_COMMENT_PREFIX)) return null;
  const field = trusted
    .slice(TRUSTED_COMMENT_PREFIX.length)
    .split('\t')
    .find((part) => part.startsWith('version:'));
  return field === undefined ? null : field.slice('version:'.length);
}

// Clients with requireSignedVersion reject a payload whose signature binds no or another version.
function validateSignedVersion(platform, signature, version, errors) {
  const signed = signedUpdaterVersion(signature);
  if (signed === null || signed.replace(/^v+/, '') !== version) {
    errors.push(
      `${platform} signature does not bind version ${version} (signed: ${signed ?? 'none'})`,
    );
  }
}

function validRepositoryName(repository) {
  if (typeof repository !== 'string') return false;
  const parts = repository.split('/');
  if (parts.length !== 2) return false;
  return parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part));
}

function validateManifestFields(manifest, version, errors) {
  if (!isObjectRecord(manifest)) {
    errors.push('latest.json must contain an object');
    return null;
  }
  if (manifest.version !== version) errors.push('latest.json version does not match the release');
  if (typeof manifest.notes !== 'string' || !manifest.notes.trim()) {
    errors.push('latest.json notes are missing');
  }
  if (typeof manifest.pub_date !== 'string' || Number.isNaN(Date.parse(manifest.pub_date))) {
    errors.push('latest.json pub_date is missing or invalid');
  }
  if (!isObjectRecord(manifest.platforms)) {
    errors.push('latest.json platforms must be an object');
    return null;
  }
  validatePlatformNames(manifest.platforms, errors);
  return manifest.platforms;
}

function validatePlatformNames(platforms, errors) {
  const actual = Object.keys(platforms).sort();
  const expected = [...PLATFORMS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`latest.json must contain exactly: ${PLATFORMS.join(', ')}`);
  }
}

function expectedPlatformUrl(repository, version, asset) {
  if (!asset) return '';
  const fileName = asset.replaceAll(' ', '.');
  return `https://github.com/${repository}/releases/download/v${version}/${fileName}`;
}

function validatePlatformEntry({ platforms, platform, assetKey, context, errors }) {
  const entry = platforms[platform];
  if (!isObjectRecord(entry)) {
    errors.push(`latest.json is missing ${platform}`);
    return;
  }

  const asset = context.assetCheck.selected[assetKey];
  if (entry.url !== expectedPlatformUrl(context.repository, context.version, asset)) {
    errors.push(`${platform} URL does not target its required updater payload`);
  }
  if (!validBase64(entry.signature)) errors.push(`${platform} signature is missing or malformed`);
  const sidecar = asset ? context.signatures?.[`${asset}.sig`]?.trim() : undefined;
  if (!sidecar || entry.signature !== sidecar) {
    errors.push(`${platform} signature does not match the published updater sidecar`);
  }
  validateSignedVersion(platform, entry.signature, context.version, errors);
}

function validatePlatformEntries(platforms, context, errors) {
  for (const [platform, assetKey] of PLATFORM_ASSETS) {
    validatePlatformEntry({ platforms, platform, assetKey, context, errors });
  }
}

export function validateLatestManifest({ manifest, version, repository, assetNames, signatures }) {
  const assetCheck = validateReleaseAssetNames(assetNames, version);
  const errors = [...assetCheck.errors];
  if (!validRepositoryName(repository)) errors.push('repository must be an owner/repository pair');

  const platforms = validateManifestFields(manifest, version, errors);
  if (platforms) {
    validatePlatformEntries(platforms, { assetCheck, repository, version, signatures }, errors);
  }
  return { ok: errors.length === 0, errors };
}

function remoteAssetMap(remoteAssets) {
  return new Map(remoteAssets.map((asset) => [asset.name, asset]));
}

function reportDuplicateRemoteNames(remoteAssets, errors) {
  const duplicates = duplicateNames(remoteAssets.map((asset) => asset.name));
  for (const name of duplicates) errors.push(`duplicate uploaded asset names: ${name}`);
}

function compareUploadedAsset(expectedName, local, remote, errors) {
  if (!remote) {
    errors.push(`uploaded release is missing ${expectedName}`);
    return;
  }
  const remoteSize = Number(remote.size);
  if (!Number.isSafeInteger(remoteSize)) {
    errors.push(`${expectedName} uploaded size is missing or invalid`);
  } else if (remoteSize <= 0) {
    errors.push(`${expectedName} uploaded size must be positive`);
  } else if (remoteSize !== Number(local.size)) {
    errors.push(`${expectedName} uploaded size differs from the validated file`);
  }
  if (typeof remote.digest !== 'string') {
    errors.push(`${expectedName} uploaded SHA-256 digest is missing or invalid`);
  } else if (!/^sha256:[0-9a-f]{64}$/.test(remote.digest)) {
    errors.push(`${expectedName} uploaded SHA-256 digest is missing or invalid`);
  } else if (remote.digest !== local.digest) {
    errors.push(`${expectedName} uploaded SHA-256 differs from the validated file`);
  }
}

function compareExpectedRemoteAssets(expected, actual, errors) {
  for (const [name, local] of expected) compareUploadedAsset(name, local, actual.get(name), errors);
}

function reportUnexpectedRemoteAssets(expected, actual, errors) {
  const unexpected = [...actual.keys()].filter((name) => !expected.has(name));
  for (const name of unexpected) errors.push(`unexpected uploaded asset: ${name}`);
}

export function validateRemoteAssetRecords(localAssets, remoteAssets) {
  const errors = [];
  reportDuplicateRemoteNames(remoteAssets, errors);
  const expected = new Map(localAssets.map((asset) => [asset.name.replaceAll(' ', '.'), asset]));
  const actual = remoteAssetMap(remoteAssets);
  compareExpectedRemoteAssets(expected, actual, errors);
  reportUnexpectedRemoteAssets(expected, actual, errors);
  return { ok: errors.length === 0, errors };
}

async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
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
    assets.push({ name: entry.name, path, size: metadata.size, digest: await digestFile(path) });
  }
  return assets;
}

async function readSidecars(directory, assets) {
  const sidecars = {};
  for (const { name } of assets) {
    if (name.endsWith('.sig')) sidecars[name] = await readFile(join(directory, name), 'utf8');
  }
  return sidecars;
}

async function loadReleaseInputs(directory) {
  const assets = await readAssetDirectory(directory);
  return {
    assets,
    names: assets.map((asset) => asset.name),
    signatures: await readSidecars(directory, assets),
  };
}

function report(result) {
  if (!result.ok) {
    for (const error of result.errors) console.error(`release gate: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('release asset gate passed');
}

async function runAssetsMode(version, directory) {
  const { names } = await loadReleaseInputs(directory);
  report(validateReleaseAssetNames(names, version));
}

function manifestForRelease(version, repository, selected, signatures) {
  const updater = (assetKey) => {
    const asset = selected[assetKey];
    return {
      signature: asset ? (signatures[`${asset}.sig`] ?? '').trim() : '',
      url: expectedPlatformUrl(repository, version, asset),
    };
  };
  return {
    version,
    notes: 'See release notes',
    pub_date: new Date().toISOString(),
    platforms: {
      'linux-x86_64': updater('linuxAppImage'),
      'windows-x86_64': updater('windowsSetup'),
      'darwin-aarch64': updater('macUpdater'),
      'darwin-x86_64': updater('macIntelUpdater'),
    },
  };
}

async function runGenerateMode(version, directory, repository) {
  const { names, signatures } = await loadReleaseInputs(directory);
  const assetCheck = validateReleaseAssetNames(names, version);
  if (!assetCheck.ok) return report(assetCheck);

  const manifest = manifestForRelease(version, repository, assetCheck.selected, signatures);
  const result = validateLatestManifest({
    manifest,
    version,
    repository,
    assetNames: names,
    signatures,
  });
  if (!result.ok) return report(result);
  await writeFile(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('generated and validated latest.json for all four signed updater platforms');
}

async function readManifest(directory) {
  return JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
}

async function runValidateMode(version, directory, repository) {
  const { names, signatures } = await loadReleaseInputs(directory);
  const manifest = await readManifest(directory);
  report(
    validateLatestManifest({
      manifest,
      version,
      repository,
      assetNames: names.filter((name) => name !== 'latest.json'),
      signatures,
    }),
  );
}

function splitRemoteAssetFields(line) {
  const fields = line.split('\t');
  if (fields.length !== 3) {
    throw new Error('remote release asset inventory has an invalid TSV record');
  }
  return fields;
}

function parseRemoteAssetSize(sizeText) {
  if (!/^\d+$/.test(sizeText)) {
    throw new Error('remote release asset inventory has a non-integer asset size');
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size)) {
    throw new Error('remote release asset inventory has an unsafe asset size');
  }
  if (size <= 0) throw new Error('remote release asset inventory has a non-positive asset size');
  return size;
}

function parseRemoteAssetDigest(digest) {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error('remote release asset inventory is missing or has an invalid SHA-256 digest');
  }
  return digest;
}

function parseRemoteAssetRecord(line) {
  const [name = '', sizeText = '', digest = ''] = splitRemoteAssetFields(line);
  if (!name) throw new Error('remote release asset inventory has an empty asset name');
  return {
    name,
    size: parseRemoteAssetSize(sizeText),
    digest: parseRemoteAssetDigest(digest),
  };
}

export function parseRemoteAssetRecords(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    records.push(parseRemoteAssetRecord(line));
  }
  return records;
}

function validateRemoteInputs(assets, manifestResult) {
  if (!manifestResult.ok) return manifestResult;
  const latestAssets = assets.filter((asset) => asset.name === 'latest.json');
  if (
    latestAssets.length !== 1 ||
    !assets.every((asset) => /^sha256:[0-9a-f]{64}$/.test(asset.digest))
  ) {
    return {
      ok: false,
      errors: ['local release package must include latest.json and SHA-256 digests'],
    };
  }
  return { ok: true, errors: [] };
}

async function runRemoteMode(version, directory, repository, inputFile) {
  if (!inputFile) throw new Error('remote mode requires the paginated GitHub asset TSV path');
  const inputs = await loadReleaseInputs(directory);
  const manifest = await readManifest(directory);
  const manifestResult = validateLatestManifest({
    manifest,
    version,
    repository,
    assetNames: inputs.names.filter((name) => name !== 'latest.json'),
    signatures: inputs.signatures,
  });
  const inputResult = validateRemoteInputs(inputs.assets, manifestResult);
  if (!inputResult.ok) return report(inputResult);

  const remoteText = await readFile(inputFile, 'utf8');
  report(validateRemoteAssetRecords(inputs.assets, parseRemoteAssetRecords(remoteText)));
}

const MODE_HANDLERS = {
  assets: runAssetsMode,
  generate: runGenerateMode,
  validate: runValidateMode,
  remote: runRemoteMode,
};

const CLI_USAGE =
  'usage: release-assets-guard.mjs <assets|generate|validate|remote> <version> <asset-dir> [repository] [input-file]';

function requireCliArguments(args) {
  if (args.slice(0, 3).some((argument) => !argument)) throw new Error(CLI_USAGE);
}

function resolveModeHandler(mode) {
  if (!Object.hasOwn(MODE_HANDLERS, mode)) {
    throw new Error(`unknown release gate mode: ${mode}`);
  }
  return MODE_HANDLERS[mode];
}

function parseCliInvocation(args) {
  requireCliArguments(args);
  const [mode, version, directory, repository, inputFile] = args;
  return { handler: resolveModeHandler(mode), version, directory, repository, inputFile };
}

async function main(args) {
  const invocation = parseCliInvocation(args);
  await invocation.handler(
    invocation.version,
    invocation.directory,
    invocation.repository,
    invocation.inputFile,
  );
}

if (process.argv[1] && basename(process.argv[1]) === 'release-assets-guard.mjs') {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release gate: ${error.message}`);
    process.exitCode = 1;
  });
}
