import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { computeDependencyState } from '../dependency-state.mjs';

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
  const allowedSignersFile = config['gpg.ssh.allowedSignersFile']
    ? gitOutput(['config', '--path', '--get', 'gpg.ssh.allowedSignersFile'], { cwd })
    : '';
  return {
    format: config['gpg.format'] || 'openpgp',
    keyConfigured: Boolean(config['user.signingkey']),
    gpgProgramConfigured: Boolean(config['gpg.program']),
    allowedSignersConfigured: Boolean(config['gpg.ssh.allowedSignersFile']),
    enabled: isSigningEnabled(config),
    keyDisplay: config['user.signingkey'] ? basename(config['user.signingkey']) : '',
    allowedSignersFile,
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
  if (signing.allowedSignersFile)
    settings.push(['gpg.ssh.allowedSignersFile', signing.allowedSignersFile]);
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

export function pushEventRange(payload) {
  const before = payload?.before;
  const after = payload?.after;
  if (!isSha(before)) throw new Error('push event is missing an exact before SHA');
  if (!isSha(after) || isZeroSha(after))
    throw new Error('push event is missing an exact after SHA');
  return { before, after };
}

export function pushCommitShas(payload, cwd = process.cwd(), rangeResolver = commitsInRange) {
  const { before, after } = pushEventRange(payload);
  return isZeroSha(before) ? [after] : rangeResolver(`${before}..${after}`, cwd);
}

// QNBS-v3: Git supplies both object IDs so malformed ref updates fail closed.
export function parseRefUpdate(line) {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 4 || !fields[0] || !fields[1] || !fields[2] || !fields[3]) return null;
  return { localRef: fields[0], localSha: fields[1], remoteRef: fields[2], remoteSha: fields[3] };
}

function isRefUpdate(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.localRef === 'string' &&
    typeof value.localSha === 'string' &&
    typeof value.remoteRef === 'string' &&
    typeof value.remoteSha === 'string'
  );
}

function validatePrePushUpdate(update) {
  if (!isRefUpdate(update)) throw new Error('pre-push update array contains an invalid record');
  if (
    (!isSha(update.localSha) && !isZeroSha(update.localSha)) ||
    (!isSha(update.remoteSha) && !isZeroSha(update.remoteSha))
  )
    throw new Error(`invalid SHA in update for ${update.remoteRef}`);
  if (!update.remoteRef.startsWith('refs/heads/') && !update.remoteRef.startsWith('refs/tags/'))
    throw new Error(`unsupported outgoing ref ${update.remoteRef}`);
  return update;
}

function validatedPrePushUpdates(input) {
  return normalizePrePushUpdates(input).map(validatePrePushUpdate);
}

// QNBS-v3: normalize every public input form through one fail-closed parser.
export function normalizePrePushUpdates(input) {
  if (typeof input === 'string') {
    if (input === '') return [];
    const lines = input.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length === 0) throw new Error('invalid pre-push ref-update input');
    const updates = lines.map(parseRefUpdate);
    if (updates.some((update) => !update)) throw new Error('invalid pre-push ref-update input');
    return updates;
  }
  if (!Array.isArray(input)) throw new Error('pre-push input must be text or an update array');
  if (input.length === 0) return [];
  if (input.every((item) => typeof item === 'string'))
    return normalizePrePushUpdates(input.join('\n'));
  if (input.every(isRefUpdate)) return input;
  throw new Error('pre-push update array contains an invalid record');
}

export function serializePrePushEvidence(input) {
  return JSON.stringify({ version: 1, updates: validatedPrePushUpdates(input) });
}

export function parsePrePushEvidence(serialized) {
  if (typeof serialized !== 'string' || serialized.length === 0)
    throw new Error('pre-push evidence artifact is empty');
  let document;
  try {
    document = JSON.parse(serialized);
  } catch {
    throw new Error('pre-push evidence artifact is not valid JSON');
  }
  if (document?.version !== 1 || !Array.isArray(document.updates))
    throw new Error('pre-push evidence artifact has an unsupported shape');
  return normalizePrePushUpdates(document.updates);
}

export function readPrePushEvidenceFile(file) {
  if (typeof file !== 'string' || file.length === 0)
    throw new Error('pre-push evidence file is missing');
  return parsePrePushEvidence(readFileSync(file, 'utf8'));
}

export function writePrePushEvidenceFile(file, input) {
  if (typeof file !== 'string' || file.length === 0)
    throw new Error('pre-push evidence file is missing');
  writeFileSync(file, serializePrePushEvidence(input), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}

function changedFilesBetween(base, head, cwd) {
  const result = runGit(['diff', '--no-renames', '--name-only', '-z', base, head, '--'], { cwd });
  if (result.status !== 0) throw new Error('cannot resolve changed paths for outgoing ref');
  return result.stdout.split('\0').filter((path) => path.length > 0);
}

// QNBS-v3: diagnostic-only signal; never throws, so it cannot corrupt canonical evidence validity.
export function computeWorkingTreeState(sha, cwd, dependencies = {}) {
  const runGitFn = dependencies.runGit ?? runGit;
  let result;
  try {
    // QNBS-v3: intentionally tracked-content only -- untracked files never make MATCHES a proof.
    result = runGitFn(['diff', '--quiet', sha, '--'], { cwd });
  } catch {
    return 'UNKNOWN';
  }
  if (result.error) return 'UNKNOWN';
  if (result.status === 0) return 'MATCHES';
  if (result.status === 1) return 'DIVERGED';
  return 'UNKNOWN';
}

// QNBS-v3: shared by every diagnostic-only dimension so precedence can never drift between them.
function aggregateDiagnosticState(states) {
  const relevant = states.filter((state) => state !== 'NOT_APPLICABLE');
  if (relevant.length === 0) return 'NOT_APPLICABLE';
  if (relevant.includes('DIVERGED')) return 'DIVERGED';
  if (relevant.includes('UNKNOWN')) return 'UNKNOWN';
  return 'MATCHES';
}

export function resolvePushEvidence(input, cwd = process.cwd(), dependencies = {}) {
  try {
    const updates = validatedPrePushUpdates(input);
    const commitExists =
      dependencies.commitExists ??
      ((sha) => isSha(sha) && runGit(['cat-file', '-e', `${sha}^{commit}`], { cwd }).status === 0);
    const objectExists =
      dependencies.objectExists ??
      ((sha) => isSha(sha) && runGit(['cat-file', '-e', `${sha}^{object}`], { cwd }).status === 0);
    const resolveFiles =
      dependencies.changedFilesBetween ?? ((base, head) => changedFilesBetween(base, head, cwd));
    const matchesWorktree =
      dependencies.worktreeMatchesCommit ?? ((sha) => computeWorkingTreeState(sha, cwd));
    const matchesDependencyState =
      dependencies.dependencyStateForRef ?? ((sha) => computeDependencyState(sha, cwd));
    const changedFiles = new Set();
    const evidenceUpdates = [];
    for (const update of updates) {
      if (isZeroSha(update.localSha)) {
        evidenceUpdates.push({
          ...update,
          disposition: 'DELETED',
          workingTreeState: 'NOT_APPLICABLE',
          dependencyState: 'NOT_APPLICABLE',
        });
        continue;
      }
      if (update.remoteRef.startsWith('refs/tags/')) {
        if (!objectExists(update.localSha))
          throw new Error(`local outgoing object is unavailable for ${update.localRef}`);
        evidenceUpdates.push({
          ...update,
          disposition: 'TAG',
          workingTreeState: matchesWorktree(update.localSha),
          dependencyState: matchesDependencyState(update.localSha),
        });
        continue;
      }
      if (!commitExists(update.localSha))
        throw new Error(`local outgoing commit is unavailable for ${update.localRef}`);
      const base = isZeroSha(update.remoteSha) ? EMPTY_TREE : update.remoteSha;
      if (base !== EMPTY_TREE && !commitExists(base))
        throw new Error(`remote base commit is unavailable for ${update.remoteRef}`);
      for (const path of resolveFiles(base, update.localSha)) changedFiles.add(path);
      evidenceUpdates.push({
        ...update,
        base,
        disposition: isZeroSha(update.remoteSha) ? 'NEW_BRANCH' : 'UPDATED',
        workingTreeState: matchesWorktree(update.localSha),
        dependencyState: matchesDependencyState(update.localSha),
      });
    }
    // QNBS-v3: tag updates prove object validity but not a complete changed-path set.
    const pathEvidenceState = evidenceUpdates.some(({ disposition }) => disposition === 'TAG')
      ? 'PARTIAL'
      : 'COMPLETE';
    return {
      updates: evidenceUpdates,
      changedFiles: [...changedFiles],
      evidenceState: 'RESOLVED',
      pathEvidenceState,
      workingTreeState: aggregateDiagnosticState(evidenceUpdates.map((u) => u.workingTreeState)),
      dependencyState: aggregateDiagnosticState(evidenceUpdates.map((u) => u.dependencyState)),
    };
  } catch (error) {
    return {
      updates: [],
      changedFiles: [],
      evidenceState: 'INVALID',
      pathEvidenceState: 'PARTIAL',
      workingTreeState: 'NOT_APPLICABLE',
      dependencyState: 'NOT_APPLICABLE',
      reason: error instanceof Error ? error.message : 'invalid push evidence',
    };
  }
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

export function outgoingBaseShas(update, fallbackBases) {
  if (!isZeroSha(update.remoteSha)) {
    if (!isSha(update.remoteSha)) throw new Error('invalid remote SHA in pre-push update');
    return [update.remoteSha];
  }
  return fallbackBases;
}

export function introducedCommits(update, remote, cwd = process.cwd()) {
  if (update.remoteRef.startsWith('refs/tags/')) return [];
  if (!update.remoteRef.startsWith('refs/heads/')) {
    throw new Error(`unsupported outgoing ref ${update.remoteRef}`);
  }
  const bases = outgoingBaseShas(update, remoteTrackingBases(remote, update.remoteRef, cwd));
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
  if (tag.objectType === 'commit')
    return { ok: false, reason: 'release tag is not an annotated tag object' };
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
  if (objectType === 'commit')
    return { ok: false, reason: 'release tag is not an annotated tag object' };
  if (objectType !== 'tag' || targetType !== 'commit')
    return { ok: false, reason: 'annotated tag does not target a commit' };
  if (tagVerificationStatus !== 0)
    return { ok: false, reason: 'Git-native tag signature verification failed' };
  return commitVerification.ok
    ? { ok: true, reason: 'tag and target commit verified' }
    : commitVerification;
}

export function verifyOutgoingUpdates(input, remote, cwd = process.cwd(), dependencies = {}) {
  const verifyCommit = dependencies.verifyCommitObject ?? ((sha) => verifyCommitObject(sha, cwd));
  const verifyTag = dependencies.verifyTagObject ?? ((sha) => verifyTagObject(sha, cwd));
  const getIntroducedCommits =
    dependencies.introducedCommits ?? ((update) => introducedCommits(update, remote, cwd));
  const reports = [];
  try {
    const updates = validatedPrePushUpdates(input);
    for (const update of updates) {
      if (isZeroSha(update.localSha)) continue;
      if (update.remoteRef.startsWith('refs/tags/')) {
        const verification = verifyTag(update.localSha);
        reports.push({ sha: update.localSha, subject: update.remoteRef, verification });
        if (!verification.ok)
          return { ok: false, reports, reason: `${update.remoteRef}: ${verification.reason}` };
        continue;
      }
      const commits = getIntroducedCommits(update);
      for (const sha of commits) {
        const verification = verifyCommit(sha);
        const report = { sha, subject: commitSubject(sha, cwd), verification };
        reports.push(report);
        if (!verification.ok)
          return { ok: false, reports, reason: `${sha.slice(0, 12)}: ${verification.reason}` };
      }
    }
    return { ok: true, reports };
  } catch (error) {
    return {
      ok: false,
      reports,
      reason: error instanceof Error ? error.message : 'invalid pre-push ref-update input',
    };
  }
}

export function safeConfigSummary(cwd = process.cwd()) {
  const signing = getSigningConfig(cwd);
  const identity = getIdentity(cwd);
  const gitDir = getGitDirectory(cwd);
  const hookDir = signing.config['core.hooksPath']
    ? resolve(cwd, signing.config['core.hooksPath'])
    : gitDir
      ? join(gitDir, 'hooks')
      : null;
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
      hooksInstalled: Boolean(
        hookDir && hookNames.every((name) => existsSync(join(hookDir, name))),
      ),
    },
    unsafeOverrides: getUnsafeOverrides(),
  };
}
