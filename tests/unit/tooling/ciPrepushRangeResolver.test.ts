import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  changedFilesFromManualRange,
  isMainModule,
  resolveManualEvidence,
} from '../../../scripts/ci-prepush-range-resolver.mjs';

describe('isMainModule', () => {
  const relativeArgv1 = 'scripts/ci-prepush-lowend.mjs';
  const absoluteArgv1 = resolve(relativeArgv1);
  const moduleUrl = pathToFileURL(absoluteArgv1).href;

  // QNBS-v3: regression — package.json's ci:prepush script invokes with a relative argv[1].
  it('recognizes a relative argv1 invocation as the same file (e.g. `node scripts/x.mjs`)', () => {
    expect(isMainModule(relativeArgv1, moduleUrl)).toBe(true);
  });

  it('recognizes an absolute argv1 invocation', () => {
    expect(isMainModule(absoluteArgv1, moduleUrl)).toBe(true);
  });

  it('is false when imported rather than executed (no argv1)', () => {
    expect(isMainModule(undefined, moduleUrl)).toBe(false);
  });

  it('is false for a different file entirely', () => {
    expect(isMainModule('scripts/other.mjs', moduleUrl)).toBe(false);
  });
});

describe('manual committed-range resolution', () => {
  it('is unresolved when no upstream is configured', () => {
    const result = changedFilesFromManualRange({ resolveUpstream: () => null });

    expect(result).toEqual({ files: [], rangeResolved: false });
  });

  it('resolves and merges working-tree changes when the diff succeeds', () => {
    const result = changedFilesFromManualRange({
      resolveUpstream: () => 'origin/main',
      diffNames: (range) => {
        expect(range).toBe('origin/main..HEAD');
        return ['src/committed.ts'];
      },
      workingTreeFiles: () => ['src/dirty.ts'],
    });

    expect(result).toEqual({ files: ['src/committed.ts', 'src/dirty.ts'], rangeResolved: true });
  });

  // QNBS-v3: regression for the fail-open bug — a failed diff must not read as an empty resolved range.
  it('fails closed when the upstream resolves but the diff command itself fails', () => {
    const result = changedFilesFromManualRange({
      resolveUpstream: () => 'origin/main',
      diffNames: () => null,
      workingTreeFiles: () => {
        throw new Error('must not be called when the diff already failed');
      },
    });

    expect(result).toEqual({ files: [], rangeResolved: false });
  });

  it('treats a genuinely empty diff as a resolved, complete range', () => {
    const result = changedFilesFromManualRange({
      resolveUpstream: () => 'origin/main',
      diffNames: () => [],
      workingTreeFiles: () => [],
    });

    expect(result).toEqual({ files: [], rangeResolved: true });
  });
});

describe('resolveManualEvidence', () => {
  it('falls back to the manual committed-range resolver when no evidence file is given', () => {
    const result = resolveManualEvidence(undefined, {
      resolveUpstream: () => null,
    });

    expect(result).toEqual({ files: [], rangeResolved: false });
  });

  it('trusts changedFiles as complete when pathEvidenceState is COMPLETE', () => {
    const result = resolveManualEvidence('/tmp/evidence.json', {
      readPrePushEvidenceFile: (file) => {
        expect(file).toBe('/tmp/evidence.json');
        return 'raw';
      },
      resolvePushEvidence: () => ({
        evidenceState: 'RESOLVED',
        pathEvidenceState: 'COMPLETE',
        changedFiles: ['src/example.ts'],
      }),
    });

    expect(result).toEqual({ files: ['src/example.ts'], rangeResolved: true });
  });

  // QNBS-v3: wiring check — a PARTIAL tag push must not be treated as a complete file list.
  it('treats PARTIAL path evidence as unresolved for admission purposes', () => {
    const result = resolveManualEvidence('/tmp/evidence.json', {
      readPrePushEvidenceFile: () => 'raw',
      resolvePushEvidence: () => ({
        evidenceState: 'RESOLVED',
        pathEvidenceState: 'PARTIAL',
        changedFiles: [],
      }),
    });

    expect(result).toEqual({ files: [], rangeResolved: false });
  });

  it('throws for INVALID evidence', () => {
    expect(() =>
      resolveManualEvidence('/tmp/evidence.json', {
        readPrePushEvidenceFile: () => 'raw',
        resolvePushEvidence: () => ({
          evidenceState: 'INVALID',
          pathEvidenceState: 'PARTIAL',
          changedFiles: [],
          reason: 'boom',
        }),
      }),
    ).toThrow('boom');
  });
});
