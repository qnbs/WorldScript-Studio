import React from 'react';
import { describe, expect, it, vi } from 'vitest';

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
      reload: 'reload',
      recover: 'recover',
      recovering: 'recovering',
      reset: 'reset',
      quarantineNotice: 'quarantine notice',
      recoveryFailed: 'recovery failed',
      recoveryAlreadyPreserved: 'already preserved',
      resetWarning: 'reset warning',
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
      public readonly reason: 'corrupt' | 'io-error',
      message: string,
      public readonly projectId: string,
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

import { ProjectLoadError } from '../../services/fs/projectFsStore';
import {
  renderProjectInitializationFailure,
  renderStorageInitializationFailure,
} from '../../services/startupRecovery';

type RecoveryScreenProps = {
  copy: typeof mockCopy;
  onReset?: () => Promise<void>;
  onRecover?: () => Promise<void>;
};

function renderedScreenProps(): RecoveryScreenProps {
  const strictMode = mockRoot.render.mock.calls.at(-1)?.[0] as React.ReactElement<{
    children: React.ReactElement<RecoveryScreenProps>;
  }>;
  return strictMode.props.children.props;
}

describe('startup recovery rendering', () => {
  it('renders the database reset screen when IndexedDB initialization fails', async () => {
    await renderStorageInitializationFailure(mockRoot as never);

    expect(mockRoot.render).toHaveBeenCalledOnce();
    expect(renderedScreenProps().copy).toBe(mockCopy);
    expect(renderedScreenProps().onReset).toEqual(expect.any(Function));
  });

  it('renders quarantine for corrupt filesystem projects and preserves the exact project ID', async () => {
    mockBackendKind.mockResolvedValue('filesystem');
    mockQuarantine.mockResolvedValue({ projectId: 'p1', path: '/quarantine/p1' });
    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('corrupt', 'corrupt', 'p1'),
    );

    const props = renderedScreenProps();
    expect(props.onRecover).toEqual(expect.any(Function));
    expect(props.onReset).toBeUndefined();
    await (props.onRecover as () => Promise<void>)();
    expect(mockQuarantine).toHaveBeenCalledWith('p1');
  });

  it('does not expose reset for raw or project filesystem failures', async () => {
    mockBackendKind.mockResolvedValue('filesystem');

    await renderProjectInitializationFailure(mockRoot as never, new Error('EACCES /projects/p1'));
    expect(renderedScreenProps().onReset).toBeUndefined();

    await renderProjectInitializationFailure(
      mockRoot as never,
      new ProjectLoadError('io-error', 'io', 'p1'),
    );
    expect(renderedScreenProps().onReset).toBeUndefined();
    expect(loggerError).toHaveBeenCalled();
  });

  it('retains reset only for a non-project IndexedDB failure', async () => {
    mockBackendKind.mockResolvedValue('indexeddb');
    await renderProjectInitializationFailure(mockRoot as never, new Error('QuotaExceededError'));

    expect(renderedScreenProps().onRecover).toBeUndefined();
    expect(renderedScreenProps().onReset).toEqual(expect.any(Function));
  });
});
