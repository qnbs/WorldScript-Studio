import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRoot, mockReset, mockBackendKind, mockQuarantine, mockCopy, loggerError } = vi.hoisted(
  () => ({
    mockRoot: { render: vi.fn() },
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockBackendKind: vi.fn(),
    mockQuarantine: vi.fn(),
    mockCopy: {
      description: 'description',
      storageUnavailable: 'storage unavailable',
      projectUnavailable: 'project unavailable',
      projectIoUnavailable: 'project io unavailable',
      projectUnsupported: 'project unsupported',
      projectMigrationGap: 'project migration gap',
      reload: 'reload',
      retry: 'retry',
      recover: 'recover',
      recovering: 'recovering',
      reset: 'reset',
      quarantineNotice: 'quarantine notice',
      recoveryFailed: 'recovery failed',
      recoveryUnknown: 'recovery unknown',
      recoveryAlreadyPreserved: 'already preserved',
      resetWarning: 'reset warning',
      safeOpen: 'safe open',
      safeOpenNotice: 'safe open notice',
    },
    loggerError: vi.fn(),
  }),
);

vi.mock('../../services/dbInitialization', () => ({ resetAllDatabases: mockReset }));
vi.mock('../../services/storageService', () => ({
  storageService: {
    getStorageBackendKind: mockBackendKind,
    quarantineProject: mockQuarantine,
  },
}));
vi.mock('../../services/i18n/staticTranslate', () => ({
  getStaticTranslation: (key: string) => Promise.resolve(key),
}));
vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: loggerError },
}));
vi.mock('../../components/StorageErrorScreen', () => ({
  loadStorageErrorCopy: () => Promise.resolve(mockCopy),
  StorageErrorScreen: () => React.createElement('div'),
}));
vi.mock('../../services/fs/projectFsStore', () => {
  class ProjectLoadError extends Error {
    constructor(
      public readonly reason: 'corrupt' | 'io-error' | 'unsupported-version',
      message: string,
      public readonly projectId: string,
      public readonly classification?: 'FUTURE' | 'UNSUPPORTED_OLDER',
    ) {
      super(message);
      this.name = 'ProjectLoadError';
    }
  }
  class ProjectQuarantineError extends Error {
    constructor(public readonly reason: string) {
      super('safe quarantine failure');
      this.name = 'ProjectQuarantineError';
    }
  }
  return { ProjectLoadError, ProjectQuarantineError };
});

import { DesktopStorageAuthorityUnavailableError } from '../../services/fs/fsCore';
import { ProjectLoadError } from '../../services/fs/projectFsStore';
import { PersistedProjectNotLoadableError } from '../../services/persistedProjectErrors';
import {
  renderProjectInitializationFailure,
  renderStorageInitializationFailure,
} from '../../services/startupRecovery';

type RecoveryScreenProps = {
  copy: typeof mockCopy;
  failureKind:
    | 'storage'
    | 'project-corrupt'
    | 'project-io'
    | 'project-unsupported'
    | 'project-migration-gap';
  onReset?: () => Promise<void>;
  onRecover?: () => Promise<void>;
  onRetry?: () => void;
  onSafeOpen?: () => Promise<void> | void;
};

function renderedScreenProps(): RecoveryScreenProps {
  const strictMode = mockRoot.render.mock.calls.at(-1)?.[0] as React.ReactElement<{
    children: React.ReactElement<RecoveryScreenProps>;
  }>;
  return strictMode.props.children.props;
}

// QNBS-v3: keep startup recovery actions constrained by the originating storage backend.
describe('startup recovery rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the database reset screen when IndexedDB initialization fails', async () => {
    await renderStorageInitializationFailure(mockRoot as never);

    expect(mockRoot.render).toHaveBeenCalledOnce();
    expect(renderedScreenProps().copy).toBe(mockCopy);
    expect(renderedScreenProps().failureKind).toBe('storage');
    expect(renderedScreenProps().onReset).toEqual(expect.any(Function));
  });

  // QNBS-v3 (#553 a8): the screen renders from the tagged failure and the resolved backend label — it never needs the failed storage itself — and offers retry only.
  it('renders a retry-only screen when desktop storage could not be opened', async () => {
    mockBackendKind.mockResolvedValue('filesystem');
    await renderProjectInitializationFailure(
      mockRoot as never,
      new DesktopStorageAuthorityUnavailableError(new Error('permission denied')),
    );

    const props = renderedScreenProps();
    expect(props.failureKind).toBe('project-io');
    expect(props.onRetry).toEqual(expect.any(Function));
    expect(props.onReset).toBeUndefined();
    expect(props.onRecover).toBeUndefined();
    expect(props.onSafeOpen).toBeUndefined();
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockQuarantine).not.toHaveBeenCalled();
  });

  // QNBS-v3 (#553 a9): the browser refusal of an unloadable stored project offers reload only.
  it('renders a reload-only screen for a stored project the editor cannot load', async () => {
    mockBackendKind.mockResolvedValue('indexeddb');
    await renderProjectInitializationFailure(
      mockRoot as never,
      new PersistedProjectNotLoadableError(),
    );

    const props = renderedScreenProps();
    expect(props.failureKind).toBe('project-corrupt');
    expect(props.onReset).toBeUndefined();
    expect(props.onRecover).toBeUndefined();
    expect(props.onSafeOpen).toBeUndefined();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('renders quarantine for corrupt filesystem projects and preserves the exact project ID', async () => {
    mockBackendKind.mockResolvedValue('filesystem');
    mockQuarantine.mockResolvedValue({ projectId: 'p1', path: '/quarantine/p1' });
    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('corrupt', 'corrupt', 'p1'),
    );

    const props = renderedScreenProps();
    expect(props.failureKind).toBe('project-corrupt');
    expect(props.onRecover).toEqual(expect.any(Function));
    expect(props.onReset).toBeUndefined();
    await (props.onRecover as () => Promise<void>)();
    expect(mockQuarantine).toHaveBeenCalledWith('p1');
  });

  it('does not expose reset for raw or project filesystem failures', async () => {
    mockBackendKind.mockResolvedValue('filesystem');

    await renderProjectInitializationFailure(mockRoot as never, new Error('EACCES /projects/p1'));
    expect(renderedScreenProps().failureKind).toBe('project-io');
    expect(renderedScreenProps().onReset).toBeUndefined();

    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('io-error', 'io', 'p1'),
    );
    expect(renderedScreenProps().failureKind).toBe('project-io');
    expect(renderedScreenProps().onReset).toBeUndefined();
    expect(renderedScreenProps().onRecover).toBeUndefined();
    expect(renderedScreenProps().onRetry).toEqual(expect.any(Function));
    expect(loggerError).toHaveBeenCalled();
  });

  it('retains reset only for a non-project IndexedDB failure', async () => {
    mockBackendKind.mockResolvedValue('indexeddb');
    await renderProjectInitializationFailure(mockRoot as never, new Error('QuotaExceededError'));

    expect(renderedScreenProps().onRecover).toBeUndefined();
    expect(renderedScreenProps().failureKind).toBe('storage');
    expect(renderedScreenProps().onReset).toEqual(expect.any(Function));
  });

  // QNBS-v3: unsupported versions expose retry-only recovery so no destructive authority is offered.
  it('renders unsupported project versions without quarantine or reset authority', async () => {
    mockBackendKind.mockResolvedValue('filesystem');
    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('unsupported-version', 'future', 'p1'),
    );

    const props = renderedScreenProps();
    expect(props.failureKind).toBe('project-unsupported');
    expect(props.onRecover).toBeUndefined();
    expect(props.onReset).toBeUndefined();
    expect(props.onRetry).toEqual(expect.any(Function));
  });

  // QNBS-v3: migration-gap recovery keeps the older-version diagnostic while remaining retry-only.
  it('renders migration-gap projects with distinct retry-only recovery', async () => {
    mockBackendKind.mockResolvedValue('filesystem');
    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('unsupported-version', 'older', 'p1', 'UNSUPPORTED_OLDER'),
    );

    const props = renderedScreenProps();
    expect(props.failureKind).toBe('project-migration-gap');
    expect(props.onRecover).toBeUndefined();
    expect(props.onReset).toBeUndefined();
    expect(props.onRetry).toEqual(expect.any(Function));
  });

  // QNBS-v3: Safe Open is a continuation callback owned by the bootstrap — it must carry the exact refused ID and never touch quarantine, reset, or deletion.
  it.each([
    ['FUTURE', 'project-unsupported'],
    ['UNSUPPORTED_OLDER', 'project-migration-gap'],
  ] as const)(
    'offers Safe Open for a %s refusal alongside Retry, without destructive calls',
    async (classification, failureKind) => {
      mockBackendKind.mockResolvedValue('filesystem');
      const onSafeOpen = vi.fn().mockResolvedValue(undefined);
      await renderProjectInitializationFailure(
        mockRoot as never,
        new ProjectLoadError('unsupported-version', 'refused', 'p1', classification),
        { onSafeOpen },
      );

      const props = renderedScreenProps();
      expect(props.failureKind).toBe(failureKind);
      expect(props.onRetry).toEqual(expect.any(Function));
      expect(props.onSafeOpen).toEqual(expect.any(Function));
      expect(props.onRecover).toBeUndefined();
      expect(props.onReset).toBeUndefined();

      await props.onSafeOpen?.();
      expect(onSafeOpen).toHaveBeenCalledExactlyOnceWith('p1');
      expect(mockQuarantine).not.toHaveBeenCalled();
      expect(mockReset).not.toHaveBeenCalled();
    },
  );

  it('does not offer Safe Open without a bootstrap continuation, or for corrupt, I/O, and storage failures', async () => {
    const onSafeOpen = vi.fn();

    mockBackendKind.mockResolvedValue('filesystem');
    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('unsupported-version', 'future', 'p1', 'FUTURE'),
    );
    expect(renderedScreenProps().onSafeOpen).toBeUndefined();

    for (const error of [
      new ProjectLoadError('corrupt', 'corrupt', 'p1'),
      new ProjectLoadError('io-error', 'io', 'p1'),
      new Error('EACCES /projects/p1'),
    ]) {
      await renderProjectInitializationFailure(mockRoot as never, error, { onSafeOpen });
      expect(renderedScreenProps().onSafeOpen).toBeUndefined();
    }

    mockBackendKind.mockResolvedValue('indexeddb');
    await renderProjectInitializationFailure(mockRoot as never, new Error('QuotaExceededError'), {
      onSafeOpen,
    });
    expect(renderedScreenProps().onSafeOpen).toBeUndefined();
    expect(onSafeOpen).not.toHaveBeenCalled();
  });
});
