import { describe, expect, it } from 'vitest';
import { DesktopStorageAuthorityUnavailableError } from '../../services/fs/fsCore';
import { ProjectLoadError } from '../../services/fs/projectFsStore';
import { getStartupRecoveryActions } from '../../services/startupRecoveryPolicy';

// QNBS-v3: prevent filesystem corruption from acquiring destructive database-reset authority.
describe('startup recovery action policy', () => {
  it('offers quarantine only for corrupt projects on the filesystem backend', () => {
    const error = new ProjectLoadError('corrupt', 'corrupt', 'project-1');

    expect(getStartupRecoveryActions(error, 'filesystem')).toEqual({
      failureKind: 'project-corrupt',
      canQuarantine: true,
      canReset: false,
      canSafeOpen: false,
    });
    expect(getStartupRecoveryActions(error, 'indexeddb')).toEqual({
      failureKind: 'project-corrupt',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: false,
    });
  });

  it('never offers destructive reset for filesystem-origin failures, including raw errors', () => {
    expect(getStartupRecoveryActions(new Error('EACCES /projects/p1'), 'filesystem')).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: false,
    });
    expect(
      getStartupRecoveryActions(new ProjectLoadError('io-error', 'io', 'project-1'), 'filesystem'),
    ).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: false,
    });
  });

  it('keeps unsupported project versions non-quarantinable, retryable, and safely openable', () => {
    expect(
      getStartupRecoveryActions(
        new ProjectLoadError('unsupported-version', 'future', 'project-1', 'FUTURE'),
        'filesystem',
      ),
    ).toEqual({
      failureKind: 'project-unsupported',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: true,
    });
  });

  // QNBS-v3: preserve migration-gap provenance so recovery copy explains why this build cannot migrate the project.
  it('distinguishes unsupported older projects from future projects', () => {
    expect(
      getStartupRecoveryActions(
        new ProjectLoadError('unsupported-version', 'older', 'project-1', 'UNSUPPORTED_OLDER'),
        'filesystem',
      ),
    ).toEqual({
      failureKind: 'project-migration-gap',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: true,
    });
  });

  // QNBS-v3: Safe Open must never widen to transient I/O, corruption, or the IndexedDB backend, whose refusal semantics differ.
  it('offers Safe Open only for refused projects on the filesystem backend', () => {
    expect(
      getStartupRecoveryActions(
        new ProjectLoadError('unsupported-version', 'future', 'project-1', 'FUTURE'),
        'indexeddb',
      ).canSafeOpen,
    ).toBe(false);
    expect(
      getStartupRecoveryActions(
        new ProjectLoadError('unsupported-version', 'older', 'project-1', 'UNSUPPORTED_OLDER'),
        'indexeddb',
      ).canSafeOpen,
    ).toBe(false);
    expect(
      getStartupRecoveryActions(new Error('unsupported-version'), 'filesystem').canSafeOpen,
    ).toBe(false);
  });

  it('retains database reset for non-project failures from IndexedDB', () => {
    expect(getStartupRecoveryActions(new Error('QuotaExceededError'), 'indexeddb')).toEqual({
      failureKind: 'storage',
      canQuarantine: false,
      canReset: true,
      canSafeOpen: false,
    });
  });

  it('does not offer database reset for project-specific IndexedDB failures', () => {
    expect(
      getStartupRecoveryActions(new ProjectLoadError('io-error', 'io', 'project-1'), 'indexeddb'),
    ).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
      canSafeOpen: false,
    });
  });

  // QNBS-v3 (#553 a8): a desktop store that failed to open is retry-only, whatever backend label accompanies it.
  it.each(['filesystem', 'indexeddb'] as const)(
    'never gives reset or quarantine authority to unopenable desktop storage (%s)',
    (backend) => {
      expect(
        getStartupRecoveryActions(
          new DesktopStorageAuthorityUnavailableError(new Error('io')),
          backend,
        ),
      ).toEqual({
        failureKind: 'project-io',
        canQuarantine: false,
        canReset: false,
        canSafeOpen: false,
      });
    },
  );
});
