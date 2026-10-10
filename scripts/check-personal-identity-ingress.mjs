#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

// QNBS-v3: audit only the introduced range; a whole-graph scan would fail closed on historical contributors the privacy rewrite already replaced.
const GITHUB_NOREPLY_EMAIL = /^\d+\+[^@\s]+@users\.noreply\.github\.com$/i;
const SHA_LINE = /^[0-9a-f]{40}$/i;
const TRAILER_LINE = /^(co-authored-by|signed-off-by):\s*(.*)$/gim;
const TAGGER_LINE = /^tagger (.+) <([^>\s]+)> \d+ [+-]\d{4}$/m;

function unavailable(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function classifyEmail(email) {
  if (typeof email !== 'string' || email.trim() === '') return 'missing';
  if (GITHUB_NOREPLY_EMAIL.test(email.trim())) return 'github-noreply';
  return 'unapproved';
}

export function validatePolicy(document) {
  if (!document || typeof document !== 'object') return { ok: false };
  if (document.schemaVersion !== 1 || document.mode !== 'fail-closed') return { ok: false };
  if (document.newWritesOnly !== true || document.allowAll === true || document.bypass === true) {
    return { ok: false };
  }
  const classes = document.allowedEmailClasses;
  if (!Array.isArray(classes) || classes.length !== 1 || classes[0] !== 'github-noreply') {
    return { ok: false };
  }
  const trailers = document.identityTrailers;
  if (
    !Array.isArray(trailers) ||
    !trailers.includes('co-authored-by') ||
    !trailers.includes('signed-off-by')
  ) {
    return { ok: false };
  }
  if (document.providerManagedRefs !== 'UNRESOLVED_PROVIDER_PURGE') return { ok: false };
  return { ok: true, policy: document };
}

export function loadPolicy(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw unavailable('POLICY_UNAVAILABLE');
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw unavailable('POLICY_UNAVAILABLE');
  }
  const validated = validatePolicy(document);
  if (!validated.ok) throw unavailable('POLICY_UNAVAILABLE');
  return validated.policy;
}

export function defaultPolicyPath(cwd = process.cwd()) {
  return join(cwd, 'config', 'personal-identity-ingress-policy.json');
}

function defaultRunGit(args, cwd = process.cwd()) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw unavailable('HISTORY_UNAVAILABLE');
  return result.stdout;
}

export function trailerFindings(message) {
  const findings = [];
  for (const match of (message ?? '').matchAll(TRAILER_LINE)) {
    const kind = match[1].toLowerCase();
    const emails = [...match[2].matchAll(/<([^<>\s]+)>/g)].map((item) => item[1]);
    if (emails.length === 0) {
      findings.push(`malformed-trailer:${kind}`);
      continue;
    }
    for (const email of emails) {
      if (classifyEmail(email) !== 'github-noreply') findings.push(`unapproved-email:${kind}`);
    }
  }
  return findings;
}

export function auditIdentityRecord(record) {
  const findings = [];
  for (const role of ['author', 'committer']) {
    const emailClass = classifyEmail(record[`${role}Email`]);
    if (emailClass === 'missing') findings.push(`missing-email:${role}`);
    else if (emailClass !== 'github-noreply') findings.push(`unapproved-email:${role}`);
  }
  findings.push(...trailerFindings(record.message));
  return { ok: findings.length === 0, findings };
}

function parseCommitRecord(raw) {
  const parts = raw.split('\0');
  if (parts.length < 5) throw unavailable('HISTORY_UNAVAILABLE');
  return {
    authorName: parts[0],
    authorEmail: parts[1],
    committerName: parts[2],
    committerEmail: parts[3],
    message: parts.slice(4).join('\0'),
  };
}

export function auditCommit(sha, runGit = defaultRunGit) {
  if (!SHA_LINE.test(sha)) throw unavailable('HISTORY_UNAVAILABLE');
  const raw = runGit(['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', sha]);
  return auditIdentityRecord(parseCommitRecord(raw));
}

export function auditTag(sha, runGit = defaultRunGit) {
  if (!SHA_LINE.test(sha)) throw unavailable('HISTORY_UNAVAILABLE');
  const type = runGit(['cat-file', '-t', sha]).trim();
  if (type !== 'tag') return { ok: false, findings: ['TAG_IDENTITY_UNAVAILABLE'] };
  const body = runGit(['cat-file', '-p', sha]);
  const tagger = body.match(TAGGER_LINE);
  if (!tagger) return { ok: false, findings: ['TAG_IDENTITY_UNAVAILABLE'] };
  const findings = [];
  if (classifyEmail(tagger[2]) !== 'github-noreply') findings.push('unapproved-email:tagger');
  findings.push(...trailerFindings(body));
  return { ok: findings.length === 0, findings };
}

function resolveCommit(rev, runGit) {
  const sha = runGit(['rev-parse', '--verify', `${rev}^{commit}`]).trim();
  if (!SHA_LINE.test(sha)) throw unavailable('HISTORY_UNAVAILABLE');
  return sha;
}

export function auditRange(base, head, runGit = defaultRunGit) {
  const baseSha = resolveCommit(base, runGit);
  const headSha = resolveCommit(head, runGit);
  const listed = runGit(['rev-list', '--reverse', `${baseSha}..${headSha}`]);
  const shas = listed.split(/\r?\n/).filter(Boolean);
  const failures = [];
  for (const sha of shas) {
    if (!SHA_LINE.test(sha)) throw unavailable('HISTORY_UNAVAILABLE');
    const result = auditCommit(sha, runGit);
    if (!result.ok) failures.push({ sha, findings: result.findings });
  }
  return { ok: failures.length === 0, audited: shas.length, failures };
}

function emit(token, code) {
  console.error(`[personal-identity-ingress] ${token}`);
  process.exitCode = code;
}

function policyFromArgs(args, cwd) {
  const index = args.indexOf('--policy');
  const filePath = index >= 0 ? args[index + 1] : defaultPolicyPath(cwd);
  if (index >= 0 && !filePath) throw unavailable('POLICY_UNAVAILABLE');
  return loadPolicy(filePath);
}

function positionalArgs(args) {
  const skip = new Set();
  for (const flag of ['--policy', '--provider-ref', '--tag']) {
    const index = args.indexOf(flag);
    if (index >= 0) {
      skip.add(index);
      skip.add(index + 1);
    }
  }
  return args.filter((_, index) => !skip.has(index));
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  let policy;
  try {
    policy = policyFromArgs(argv, cwd);
  } catch (error) {
    emit(error instanceof Error ? error.message : 'POLICY_UNAVAILABLE', 2);
    return;
  }
  void policy;
  const providerIndex = argv.indexOf('--provider-ref');
  if (providerIndex >= 0) {
    const ref = argv[providerIndex + 1] ?? '';
    if (!ref.startsWith('refs/pull/')) {
      emit('PROVIDER_REF_UNSUPPORTED', 2);
      return;
    }
    emit('UNRESOLVED_PROVIDER_PURGE', 3);
    return;
  }
  const tagIndex = argv.indexOf('--tag');
  if (tagIndex >= 0) {
    const sha = argv[tagIndex + 1];
    if (!sha) {
      emit('RANGE_REQUIRED', 2);
      return;
    }
    try {
      const resolved = defaultRunGit(['rev-parse', '--verify', sha], cwd).trim();
      const result = auditTag(resolved, (args) => defaultRunGit(args, cwd));
      if (result.ok) {
        console.log('[personal-identity-ingress] OK — audited annotated tagger');
        return;
      }
      emit(result.findings.join(','), 1);
    } catch (error) {
      emit(error instanceof Error ? error.message : 'HISTORY_UNAVAILABLE', 1);
    }
    return;
  }
  const [base, head] = positionalArgs(argv);
  if (!base || !head) {
    emit('RANGE_REQUIRED', 2);
    return;
  }
  try {
    const result = auditRange(base, head, (args) => defaultRunGit(args, cwd));
    if (!result.ok) {
      for (const failure of result.failures) {
        console.error(
          `[personal-identity-ingress] ${failure.sha.slice(0, 12)}: ${failure.findings.join(',')}`,
        );
      }
      emit('FAIL', 1);
      return;
    }
    console.log(`[personal-identity-ingress] OK — audited ${result.audited} introduced commit(s)`);
  } catch (error) {
    emit(error instanceof Error ? error.message : 'HISTORY_UNAVAILABLE', 1);
  }
}

if (process.argv[1]?.endsWith('check-personal-identity-ingress.mjs')) {
  main();
}
