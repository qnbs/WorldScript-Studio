import { describe, expect, it } from 'vitest';
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
    });
    expect(getStartupRecoveryActions(error, 'indexeddb')).toEqual({
      failureKind: 'project-corrupt',
      canQuarantine: false,
      canReset: false,
    });
  });

  it('never offers destructive reset for filesystem-origin failures, including raw errors', () => {
    expect(getStartupRecoveryActions(new Error('EACCES /projects/p1'), 'filesystem')).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
    });
    expect(
      getStartupRecoveryActions(new ProjectLoadError('io-error', 'io', 'project-1'), 'filesystem'),
    ).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
    });
  });

  it('retains database reset for non-project failures from IndexedDB', () => {
    expect(getStartupRecoveryActions(new Error('QuotaExceededError'), 'indexeddb')).toEqual({
      failureKind: 'storage',
      canQuarantine: false,
      canReset: true,
    });
  });

  it('does not offer database reset for project-specific IndexedDB failures', () => {
    expect(
      getStartupRecoveryActions(new ProjectLoadError('io-error', 'io', 'project-1'), 'indexeddb'),
    ).toEqual({
      failureKind: 'project-io',
      canQuarantine: false,
      canReset: false,
    });
  });
});
