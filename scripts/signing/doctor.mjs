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
// QNBS-v3: --hook enforces fail-closed REPOSITORY_POLICY_MODE; without it, plain diagnostic mode never treats an override as fatal.
const hookMode = process.argv.includes('--hook');
const cwd = process.cwd();
const signing = getSigningConfig(cwd);
const identity = getIdentity(cwd);
const unsafeOverrides = getUnsafeOverrides();
const policyAudit = hookMode
  ? auditRepositoryPolicy(cwd)
  : { ok: true, reason: 'not audited (EFFECTIVE_INVOCATION_MODE)' };
// QNBS-v3: gate both override classes on hookMode so plain `signing:doctor` never fails from override presence alone.
const fatalOverride = hookMode && (unsafeOverrides.length > 0 || !policyAudit.ok);

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
