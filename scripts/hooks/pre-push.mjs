import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { LOCAL_CHECK_TIMEOUTS_MS } from '../ci-prepush-related-tests.mjs';
import { normalizePrePushUpdates, writePrePushEvidenceFile } from '../signing/signing-core.mjs';
import { runNodeScript } from './shared.mjs';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

let evidenceDir;
let evidenceFile;
let exitCode = 1;
try {
  const updates = normalizePrePushUpdates(input);
  evidenceDir = await mkdtemp(join(tmpdir(), 'worldscript-prepush-'));
  evidenceFile = join(evidenceDir, 'evidence.json');
  writePrePushEvidenceFile(evidenceFile, updates);
  const childArgs = [...process.argv.slice(2), '--prepush-evidence-file', evidenceFile];
  exitCode = await runNodeScript('scripts/signing/verify-outgoing.mjs', childArgs);
  if (exitCode === 0)
    exitCode = await runNodeScript('scripts/signing/verify-attribution.mjs', childArgs);
  if (exitCode === 0) {
    // QNBS-v3: the whole local gate runs under one bound; the 120 s default SIGTERMed it mid-typecheck, which only showed as a bare FAIL.
    exitCode = await runNodeScript('scripts/ci-prepush-lowend.mjs', childArgs, {
      timeoutMs: LOCAL_CHECK_TIMEOUTS_MS.gate,
    });
  }
} catch (error) {
  console.error(
    `pre-push evidence capture failed closed: ${error instanceof Error ? error.message : 'invalid input'}`,
  );
} finally {
  if (evidenceFile) {
    try {
      await rm(evidenceFile, { force: true });
    } catch (error) {
      console.error(
        `pre-push evidence cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      if (exitCode === 0) exitCode = 1;
    }
  }
  if (evidenceDir) {
    try {
      await rm(evidenceDir, { recursive: true, force: true });
    } catch (error) {
      console.error(
        `pre-push evidence directory cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      if (exitCode === 0) exitCode = 1;
    }
  }
}
process.exit(exitCode);
