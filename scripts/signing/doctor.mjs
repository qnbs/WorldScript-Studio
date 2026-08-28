#!/usr/bin/env node
import {
  auditRepositoryPolicy,
  getIdentity,
  getSigningConfig,
  getUnsafeOverrides,
  isGitHubCompatibleEmail,
  isSigningEnabled,
  runSigningProbe,
  safeConfigSummary,
} from './signing-core.mjs';

const jsonMode = process.argv.includes('--json');
// REPOSITORY_POLICY_MODE (--hook, invoked by pre-commit.mjs): proves the effective signing
// config matches WorldScript-Studio's persisted policy, unredefined by command-scope (`git -c`)
// config. EFFECTIVE_INVOCATION_MODE (no --hook, plain `pnpm run signing:doctor`): diagnostic
// only -- reports the actual effective config without treating any override as inherently
// hostile, since a human running it interactively wants to see what would actually happen.
const hookMode = process.argv.includes('--hook');
const cwd = process.cwd();
const signing = getSigningConfig(cwd);
const identity = getIdentity(cwd);
const unsafeOverrides = getUnsafeOverrides();
const policyAudit = hookMode
  ? auditRepositoryPolicy(cwd)
  : { ok: true, reason: 'not audited (EFFECTIVE_INVOCATION_MODE)' };
const fatalOverride = unsafeOverrides.length > 0 || !policyAudit.ok;

// QNBS-v3: a fatal override must skip the probe entirely, not run it and discard the result.
const probe = fatalOverride
  ? {
      ok: false,
      reason: unsafeOverrides.length > 0 ? 'unsafe config override detected' : policyAudit.reason,
    }
  : runSigningProbe(cwd);
const summary = {
  ...safeConfigSummary(cwd),
  policyAudit: hookMode ? policyAudit : undefined,
  probe: { ok: probe.ok, reason: probe.reason ?? 'signed probe verified' },
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} else {
  console.log(`signing format: ${signing.format}`);
  console.log(`commit.gpgsign: ${isSigningEnabled(signing.config) ? 'enabled' : 'disabled'}`);
  console.log(`signing key: ${signing.keyConfigured ? 'configured' : 'missing'}`);
  console.log(
    `identity: ${identity.name && identity.email ? 'configured' : 'missing'} (${isGitHubCompatibleEmail(identity.email) ? 'GitHub noreply-compatible' : 'GitHub identity requires account verification'})`,
  );
  console.log(
    `hooks: ${summary.hooks.pathConfigured ? 'custom path configured' : 'default path'} (${summary.hooks.hooksInstalled ? 'available' : 'not installed'})`,
  );
  console.log(
    `unsafe config overrides: ${unsafeOverrides.length ? unsafeOverrides.join(', ') : 'none detected'}`,
  );
  if (hookMode) {
    console.log(
      `repository policy: ${policyAudit.ok ? 'matches persisted policy' : `mismatch — ${policyAudit.reason}`}`,
    );
  }
  console.log(`isolated signing probe: ${probe.ok ? 'passed' : `failed — ${probe.reason}`}`);
}

const hookFailure =
  !signing.enabled ||
  !signing.keyConfigured ||
  !identity.name ||
  !identity.email ||
  fatalOverride ||
  !probe.ok;
// QNBS-v3: process.exit() right after console.log can truncate output on POSIX pipes (git hooks are piped); exitCode lets stdout flush naturally.
process.exitCode = hookFailure ? 1 : 0;
