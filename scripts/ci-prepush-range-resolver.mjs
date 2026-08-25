import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { readPrePushEvidenceFile, resolvePushEvidence } from './signing/signing-core.mjs';

function parseNulDelimitedPaths(output) {
  return output.split('\0').filter(Boolean);
}

function defaultResolveUpstream() {
  const result = spawnSync('git', ['rev-parse', '--verify', '@{upstream}'], { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
}

// QNBS-v3: returns null (not []) on failure so a broken diff can't masquerade as an empty range.
function defaultDiffNames(range) {
  const result = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', range], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return parseNulDelimitedPaths(result.stdout ?? '');
}

function defaultWorkingTreeFiles() {
  const staged = spawnSync('git', ['diff', '--no-renames', '--name-only', '-z', 'HEAD'], {
    encoding: 'utf8',
  });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  return parseNulDelimitedPaths(staged.status === 0 ? (staged.stdout ?? '') : '').concat(
    parseNulDelimitedPaths(untracked.status === 0 ? (untracked.stdout ?? '') : ''),
  );
}

export function changedFilesFromManualRange(dependencies = {}) {
  const resolveUpstream = dependencies.resolveUpstream ?? defaultResolveUpstream;
  const diffNames = dependencies.diffNames ?? defaultDiffNames;
  const workingTreeFiles = dependencies.workingTreeFiles ?? defaultWorkingTreeFiles;

  const upstream = resolveUpstream();
  if (!upstream) return { files: [], rangeResolved: false };
  const diffFiles = diffNames(`${upstream}..HEAD`);
  if (diffFiles === null) return { files: [], rangeResolved: false };
  return { files: diffFiles.concat(workingTreeFiles()), rangeResolved: true };
}

export function resolveManualEvidence(evidenceFile, dependencies = {}) {
  if (evidenceFile === undefined) return changedFilesFromManualRange(dependencies);
  const resolveEvidence = dependencies.resolvePushEvidence ?? resolvePushEvidence;
  const readEvidenceFile = dependencies.readPrePushEvidenceFile ?? readPrePushEvidenceFile;
  const evidence = resolveEvidence(readEvidenceFile(evidenceFile), process.cwd());
  if (evidence.evidenceState !== 'RESOLVED') throw new Error(evidence.reason ?? 'invalid evidence');
  // QNBS-v3: pathEvidenceState, not evidenceState, tells us whether changedFiles is trustworthy.
  return { files: evidence.changedFiles, rangeResolved: evidence.pathEvidenceState === 'COMPLETE' };
}
