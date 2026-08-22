import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/i;
const ZERO_SHA = /^0{40}$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export function runGit(args, { cwd = process.cwd(), input = '' } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      SSH_ASKPASS: '/bin/false',
      SSH_ASKPASS_REQUIRE: 'force',
    },
    input,
    timeout: 5000,
    killSignal: 'SIGTERM',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

export function gitOutput(args, options = {}) {
  const result = runGit(args, options);
  return result.status === 0 ? result.stdout.trim() : '';
}

export function isSha(value) {
  return SHA.test(value);
}

export function isZeroSha(value) {
  return ZERO_SHA.test(value);
}

export function getRepositoryRoot(cwd = process.cwd()) {
  const root = gitOutput(['rev-parse', '--show-toplevel'], { cwd });
  return root ? resolve(root) : null;
}

export function getGitDirectory(cwd = process.cwd()) {
  const gitDir = gitOutput(['rev-parse', '--git-dir'], { cwd });
  return gitDir ? resolve(cwd, gitDir) : null;
}

export function getConfig(cwd = process.cwd()) {
  const keys = [
    'user.email',
    'user.name',
    'user.signingkey',
    'commit.gpgsign',
    'gpg.format',
    'gpg.program',
    'gpg.ssh.allowedSignersFile',
    'core.hooksPath',
  ];
  const values = Object.fromEntries(
    keys.map((key) => [key, gitOutput(['config', '--get', key], { cwd })]),
  );
  return values;
}

export function getIdentity(cwd = process.cwd()) {
  const config = getConfig(cwd);
  return { name: config['user.name'], email: config['user.email'] };
}

export function isGitHubCompatibleEmail(email) {
  return /^\d+\+[^@\s]+@users\.noreply\.github\.com$/i.test(email);
}

export function getUnsafeOverrides(env = process.env) {
  const names = [
    'GIT_CONFIG_NOSYSTEM',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
  ];
  return names.filter((name) => env[name] !== undefined).map((name) => name);
}

export function isSigningEnabled(config) {
  return /^(true|yes|on|1)$/i.test(config['commit.gpgsign'] ?? '');
}

export function getSigningConfig(cwd = process.cwd()) {
  const config = getConfig(cwd);
  return {
    format: config['gpg.format'] || 'openpgp',
    keyConfigured: Boolean(config['user.signingkey']),
    gpgProgramConfigured: Boolean(config['gpg.program']),
    allowedSignersConfigured: Boolean(config['gpg.ssh.allowedSignersFile']),
    enabled: isSigningEnabled(config),
    keyDisplay: config['user.signingkey'] ? basename(config['user.signingkey']) : '',
    config,
  };
}

function configureProbeRepository(repo, signing, identity) {
  const settings = [
    ['user.name', identity.name || 'WorldScript signing probe'],
    ['user.email', identity.email || 'signing-probe@users.noreply.github.com'],
    ['commit.gpgsign', 'true'],
    ['core.hooksPath', join(repo, 'hooks-disabled')],
  ];
  if (signing.config['gpg.format']) settings.push(['gpg.format', signing.config['gpg.format']]);
  if (signing.config['user.signingkey'])
    settings.push(['user.signingkey', signing.config['user.signingkey']]);
  if (signing.config['gpg.program']) settings.push(['gpg.program', signing.config['gpg.program']]);
  for (const [key, value] of settings) {
    const result = runGit(['config', key, value], { cwd: repo });
    if (result.status !== 0) return false;
  }
  return true;
}

function signingFailureReason(stderr) {
  const message = stderr.toLowerCase();
  if (message.includes('passphrase')) return 'signing key requires an unavailable passphrase';
  if (message.includes('no such file') || message.includes('cannot open'))
    return 'signing key or signer program is unavailable';
  return 'Git signing command failed';
}

export function runSigningProbe(cwd = process.cwd()) {
  const signing = getSigningConfig(cwd);
  const identity = getIdentity(cwd);
  if (!signing.enabled) return { ok: false, reason: 'commit.gpgsign is not enabled' };
  if (!signing.keyConfigured) return { ok: false, reason: 'no signing key is configured' };
  if (!identity.name || !identity.email)
    return { ok: false, reason: 'user.name and user.email are required' };

  let probe;
  try {
    probe = mkdtempSync(join(tmpdir(), 'worldscript-signing-probe-'));
  } catch (error) {
    if (error?.code !== 'EROFS' && error?.code !== 'EACCES') throw error;
    probe = mkdtempSync(join(cwd, '.worldscript-signing-probe-'));
  }
  try {
    let result = runGit(['init', '--quiet', '--initial-branch=main', probe]);
    if (result.status !== 0 || !configureProbeRepository(probe, signing, identity)) {
      return { ok: false, reason: 'isolated probe repository could not be configured' };
    }
    result = runGit(
      ['commit-tree', '-S', '-m', 'WorldScript signing capability probe', EMPTY_TREE],
      {
        cwd: probe,
      },
    );
    if (result.status !== 0 || !isSha(result.stdout.trim())) {
      return {
        ok: false,
        reason: `plumbing-level signed commit could not be created: ${signingFailureReason(result.stderr)}`,
      };
    }
    const commit = result.stdout.trim();
    const verification = verifyCommitObject(commit, probe);
    return verification.ok
      ? { ok: true, commit }
      : { ok: false, reason: `Git-native verification failed: ${verification.reason}` };
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

export function hasCommitSignature(commitText) {
  return /(^|\n)gpgsig /.test(commitText);
}

export function classifyCommitObject({ objectType, contents, verificationStatus }) {
  if (objectType !== 'commit') return { ok: false, reason: 'object is not a commit' };
  if (!hasCommitSignature(contents)) return { ok: false, reason: 'commit has no signature object' };
  if (verificationStatus !== 0)
    return { ok: false, reason: 'Git-native signature verification failed' };
  return { ok: true, reason: 'Git-native signature verified' };
}

export function verifyCommitObject(sha, cwd = process.cwd()) {
  if (!isSha(sha)) return { ok: false, reason: 'invalid commit SHA' };
  const object = runGit(['cat-file', '-t', sha], { cwd });
  const contents = runGit(['cat-file', '-p', sha], { cwd });
  const verified = runGit(['verify-commit', '--raw', sha], { cwd });
  return classifyCommitObject({
    objectType: object.status === 0 ? object.stdout.trim() : '',
    contents: contents.status === 0 ? contents.stdout : '',
    verificationStatus: verified.status,
  });
}

export function commitSubject(sha, cwd = process.cwd()) {
  return gitOutput(['show', '-s', '--format=%s', sha], { cwd }) || '(subject unavailable)';
}

export function commitsInRange(range, cwd = process.cwd()) {
  if (!range || /\s/.test(range)) throw new Error('range must be one Git revision range');
  const result = runGit(['rev-list', '--reverse', range], { cwd });
  if (result.status !== 0) throw new Error('requested Git range is not available');
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

export function verifyCommitRange(range, cwd = process.cwd()) {
  return commitsInRange(range, cwd).map((sha) => ({
    sha,
    subject: commitSubject(sha, cwd),
    verification: verifyCommitObject(sha, cwd),
  }));
}

// QNBS-v3: Git supplies both object IDs so malformed ref updates fail closed.
export function parseRefUpdate(line) {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 4 || !fields[0] || !fields[1] || !fields[2] || !fields[3]) return null;
  return { localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] };
}

function refSha(ref, cwd) {
  const sha = gitOutput(['rev-parse', '--verify', `${ref}^{commit}`], { cwd });
  return isSha(sha) ? sha : null;
}

export function remoteTrackingBases(remote, remoteRef, cwd = process.cwd()) {
  const bases = [];
  const add = (ref) => {
    const sha = refSha(ref, cwd);
    if (sha && !bases.includes(sha)) bases.push(sha);
  };
  if (remoteRef.startsWith('refs/heads/')) {
    const branch = remoteRef.slice('refs/heads/'.length);
    add(`refs/remotes/${remote}/${branch}`);
    const symbolic = gitOutput(
      ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
      { cwd },
    );
    if (symbolic) add(symbolic);
    add(`refs/remotes/${remote}/main`);
    add(`refs/remotes/${remote}/master`);
  }
  return bases;
}

export function introducedCommits(update, remote, cwd = process.cwd()) {
  if (update.remoteRef.startsWith('refs/tags/')) return [];
  if (!update.remoteRef.startsWith('refs/heads/')) {
    throw new Error(`unsupported outgoing ref ${update.remoteRef}`);
  }
  const bases = remoteTrackingBases(remote, update.remoteRef, cwd);
  const args = ['rev-list', '--reverse', update.localSha, ...bases.map((base) => `^${base}`)];
  const result = runGit(args, { cwd });
  if (result.status !== 0)
    throw new Error(`cannot enumerate outgoing commits for ${update.localRef}`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

export function selectIntroducedCommits(commits, reachableFromBase) {
  const excluded = new Set(reachableFromBase);
  return commits.filter((sha) => !excluded.has(sha));
}

export function parseAnnotatedTag(sha, cwd = process.cwd()) {
  const type = gitOutput(['cat-file', '-t', sha], { cwd });
  if (type === 'commit') return { objectType: 'commit', target: sha };
  if (type !== 'tag') return null;
  const body = gitOutput(['cat-file', '-p', sha], { cwd });
  const target = body.match(/^object ([0-9a-f]{40})$/m)?.[1] ?? '';
  const targetType = target ? gitOutput(['cat-file', '-t', target], { cwd }) : '';
  return { objectType: 'tag', target, targetType };
}

export function verifyTagObject(sha, cwd = process.cwd()) {
  const tag = parseAnnotatedTag(sha, cwd);
  if (!tag) return { ok: false, reason: 'tag target is not a commit or annotated tag' };
  if (tag.objectType === 'commit') return verifyCommitObject(tag.target, cwd);
  if (!tag.target || tag.targetType !== 'commit')
    return { ok: false, reason: 'annotated tag does not target a commit' };
  const verifiedTag = runGit(['verify-tag', '--raw', sha], { cwd });
  if (verifiedTag.status !== 0)
    return { ok: false, reason: 'Git-native tag signature verification failed' };
  const verifiedCommit = verifyCommitObject(tag.target, cwd);
  return verifiedCommit.ok
    ? { ok: true, reason: 'tag and target commit verified' }
    : verifiedCommit;
}

export function classifyTagVerification({
  objectType,
  targetType,
  tagVerificationStatus,
  commitVerification,
}) {
  if (objectType === 'commit') return commitVerification;
  if (objectType !== 'tag' || targetType !== 'commit')
    return { ok: false, reason: 'annotated tag does not target a commit' };
  if (tagVerificationStatus !== 0)
    return { ok: false, reason: 'Git-native tag signature verification failed' };
  return commitVerification.ok
    ? { ok: true, reason: 'tag and target commit verified' }
    : commitVerification;
}

export function verifyOutgoingUpdates(lines, remote, cwd = process.cwd()) {
  const updates = lines.map(parseRefUpdate);
  if (updates.some((update) => !update))
    return { ok: false, reason: 'invalid pre-push ref-update input' };
  const reports = [];
  for (const update of updates) {
    if (isZeroSha(update.localSha)) continue;
    if (!isSha(update.localSha))
      return { ok: false, reason: `invalid outgoing SHA for ${update.remoteRef}` };
    if (update.remoteRef.startsWith('refs/tags/')) {
      const verification = verifyTagObject(update.localSha, cwd);
      reports.push({ sha: update.localSha, subject: update.remoteRef, verification });
      if (!verification.ok)
        return { ok: false, reports, reason: `${update.remoteRef}: ${verification.reason}` };
      continue;
    }
    const commits = introducedCommits(update, remote, cwd);
    for (const sha of commits) {
      const verification = verifyCommitObject(sha, cwd);
      const report = { sha, subject: commitSubject(sha, cwd), verification };
      reports.push(report);
      if (!verification.ok)
        return { ok: false, reports, reason: `${sha.slice(0, 12)}: ${verification.reason}` };
    }
  }
  return { ok: true, reports };
}

export function safeConfigSummary(cwd = process.cwd()) {
  const signing = getSigningConfig(cwd);
  const identity = getIdentity(cwd);
  const hooks = getGitDirectory(cwd);
  const hookDir = signing.config['core.hooksPath']
    ? resolve(cwd, signing.config['core.hooksPath'])
    : hooks;
  const hookNames = ['pre-commit', 'pre-push'];
  return {
    signing: {
      format: signing.format,
      enabled: signing.enabled,
      keyConfigured: signing.keyConfigured,
      keyDisplay: signing.keyDisplay,
      gpgProgramConfigured: signing.gpgProgramConfigured,
      allowedSignersConfigured: signing.allowedSignersConfigured,
    },
    identity: {
      nameConfigured: Boolean(identity.name),
      emailConfigured: Boolean(identity.email),
      githubCompatible: isGitHubCompatibleEmail(identity.email),
    },
    hooks: {
      pathConfigured: Boolean(signing.config['core.hooksPath']),
      directory: hookDir ? basename(hookDir) : '',
      preCommitInstalled: Boolean(
        hookDir && hookNames.every((name) => existsSync(join(hookDir, name))),
      ),
    },
    unsafeOverrides: getUnsafeOverrides(),
  };
}
