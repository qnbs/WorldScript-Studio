#!/usr/bin/env node
import {
  getIdentity,
  getSigningConfig,
  getUnsafeOverrides,
  isGitHubCompatibleEmail,
  isSigningEnabled,
  runSigningProbe,
  safeConfigSummary,
} from './signing-core.mjs';

const jsonMode = process.argv.includes('--json');
const cwd = process.cwd();
const signing = getSigningConfig(cwd);
const identity = getIdentity(cwd);
const unsafeOverrides = getUnsafeOverrides();
const probe = runSigningProbe(cwd);
const summary = {
  ...safeConfigSummary(cwd),
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
    `hooks: ${summary.hooks.pathConfigured ? 'custom path configured' : 'default path'} (${summary.hooks.preCommitInstalled ? 'available' : 'not installed'})`,
  );
  console.log(
    `unsafe config overrides: ${unsafeOverrides.length ? unsafeOverrides.join(', ') : 'none detected'}`,
  );
  console.log(`isolated signing probe: ${probe.ok ? 'passed' : `failed — ${probe.reason}`}`);
}

const hookFailure =
  !signing.enabled ||
  !signing.keyConfigured ||
  !identity.name ||
  !identity.email ||
  unsafeOverrides.length > 0 ||
  !probe.ok;
process.exit(hookFailure ? 1 : 0);
