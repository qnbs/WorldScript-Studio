#!/usr/bin/env node
import process from 'node:process';
import {
  auditCommit,
  auditTag,
  defaultPolicyPath,
  loadPolicy,
} from '../check-personal-identity-ingress.mjs';
import { introducedCommits, isZeroSha, readPrePushEvidenceFile } from './signing-core.mjs';

const args = process.argv.slice(2);
const remote = args[0];
const evidenceIndex = args.indexOf('--prepush-evidence-file');
const evidenceFile = evidenceIndex >= 0 ? args[evidenceIndex + 1] : null;
if (!remote || !evidenceFile) {
  console.error(
    'pre-push personal-identity check requires the remote name and evidence file. Run "pnpm run hooks:install" to refresh the installed hook.',
  );
  process.exit(1);
}

try {
  loadPolicy(defaultPolicyPath());
  const updates = readPrePushEvidenceFile(evidenceFile);
  let audited = 0;
  for (const update of updates) {
    if (isZeroSha(update.localSha)) continue;
    if (update.remoteRef.startsWith('refs/tags/')) {
      const result = auditTag(update.localSha);
      audited += 1;
      if (!result.ok) {
        console.error(
          `pre-push personal-identity check rejected ${update.remoteRef}: ${result.findings.join(',')}`,
        );
        process.exit(1);
      }
      continue;
    }
    if (!update.remoteRef.startsWith('refs/heads/')) {
      console.error(
        `pre-push personal-identity check failed closed: unsupported ref ${update.remoteRef}`,
      );
      process.exit(1);
    }
    for (const sha of introducedCommits(update, remote)) {
      const result = auditCommit(sha);
      audited += 1;
      if (!result.ok) {
        console.error(
          `pre-push personal-identity check rejected ${sha.slice(0, 12)}: ${result.findings.join(',')}`,
        );
        process.exit(1);
      }
    }
  }
  console.log(`pre-push personal-identity check audited ${audited} outgoing object(s)`);
} catch (error) {
  console.error(
    `pre-push personal-identity check failed closed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
}
