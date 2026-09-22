import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadStorageErrorCopy,
  STARTUP_COPY_FALLBACKS,
  StorageErrorScreen,
} from '../../components/StorageErrorScreen';
import { ProjectQuarantineError } from '../../services/fs/projectFsStore';

const { getStaticTranslation, loggerError } = vi.hoisted(() => ({
  getStaticTranslation: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../../services/i18n/staticTranslate', () => ({ getStaticTranslation }));
vi.mock('../../services/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/logger')>();
  return {
    ...actual,
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: loggerError },
  };
});

// QNBS-v3: preserve truthful, accessible recovery outcomes while preventing destructive action races.
describe('StorageErrorScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStaticTranslation.mockImplementation((key: string) => Promise.resolve(`translated:${key}`));
  });

  it('loads translated recovery copy and falls back safely when a key is unavailable', async () => {
    await expect(loadStorageErrorCopy()).resolves.toMatchObject({
      description: 'translated:error.startup.description',
      recoveryAlreadyPreserved: 'translated:error.startup.recoveryAlreadyPreserved',
    });

    getStaticTranslation.mockImplementation((key: string) => Promise.resolve(key));
    await expect(loadStorageErrorCopy()).resolves.toEqual(STARTUP_COPY_FALLBACKS);
  });

  it('renders localized actions and never renders a raw recovery exception', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn().mockRejectedValue(new Error('EACCES /private/project.json'));
    const copy = {
      ...STARTUP_COPY_FALLBACKS,
      description: 'Localized description',
      projectUnavailable: 'Localized project failure',
      projectIoUnavailable: 'Localized project I/O failure',
      recover: 'Localized preserve',
      recoveryFailed: 'Localized safe failure',
    };

    render(<StorageErrorScreen copy={copy} failureKind="project-corrupt" onRecover={onRecover} />);
    expect(screen.getByText('Localized description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Localized preserve' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Localized preserve' }));

    expect(await screen.findByText('Localized safe failure')).toBeInTheDocument();
    expect(screen.queryByText('EACCES /private/project.json')).not.toBeInTheDocument();
    expect(loggerError).toHaveBeenCalledWith(
      'Project quarantine failed',
      expect.objectContaining({ error: 'EACCES /private/project.json' }),
    );
  });

  it('announces recovery without offering a destructive reset while preservation is pending', async () => {
    const user = userEvent.setup();
    let resolveRecovery: () => void = () => undefined;
    const onRecover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-corrupt"
        onRecover={onRecover}
      />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));

    expect(screen.getByRole('status')).toHaveTextContent(STARTUP_COPY_FALLBACKS.recovering);
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();

    resolveRecovery();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('keeps source-missing wording truthful when preservation cannot be confirmed', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn().mockRejectedValue(new ProjectQuarantineError('source-missing'));

    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-corrupt"
        onRecover={onRecover}
      />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));

    expect(await screen.findByText(STARTUP_COPY_FALLBACKS.recoveryUnknown)).toBeInTheDocument();
    expect(screen.queryByText(STARTUP_COPY_FALLBACKS.recoveryFailed)).not.toBeInTheDocument();
  });

  it('reports the typed already-preserved outcome and supports successful recovery', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn().mockRejectedValue(new ProjectQuarantineError('already-preserved'));
    const firstRender = render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-corrupt"
        onRecover={onRecover}
      />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));
    expect(
      await screen.findByText(STARTUP_COPY_FALLBACKS.recoveryAlreadyPreserved),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();

    firstRender.unmount();
    const successfulRecover = vi.fn().mockResolvedValue(undefined);
    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-corrupt"
        onRecover={successfulRecover}
      />,
    );
    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));
    await waitFor(() => expect(successfulRecover).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();
  });

  it('omits unsupported recovery actions when no handlers are provided', () => {
    render(<StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} failureKind="storage" />);

    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(STARTUP_COPY_FALLBACKS.storageUnavailable)).toBeInTheDocument();
  });

  it('offers database reset only for generic storage failures', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();

    render(
      <StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} failureKind="storage" onReset={onReset} />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('shows a non-destructive retry for project I/O failures without corruption or reset actions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRecover = vi.fn();
    const onReset = vi.fn();

    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-io"
        onRetry={onRetry}
        onRecover={onRecover}
        onReset={onReset}
      />,
    );

    expect(screen.getByText(STARTUP_COPY_FALLBACKS.projectIoUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(STARTUP_COPY_FALLBACKS.projectUnavailable)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.retry })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.retry }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRecover).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  // QNBS-v3: a refused project must not be an endless dead end — Safe Open sits beside Retry, is accessible, and is never a destructive action.
  it.each(['project-unsupported', 'project-migration-gap'] as const)(
    'offers an accessible non-destructive Safe Open beside Retry for %s',
    async (failureKind) => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      const onSafeOpen = vi.fn().mockResolvedValue(undefined);
      const onRecover = vi.fn();
      const onReset = vi.fn();

      render(
        <StorageErrorScreen
          copy={STARTUP_COPY_FALLBACKS}
          failureKind={failureKind}
          onRetry={onRetry}
          onSafeOpen={onSafeOpen}
          onRecover={onRecover}
          onReset={onReset}
        />,
      );

      const safeOpen = screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.safeOpen });
      expect(
        screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.retry }),
      ).toBeInTheDocument();
      expect(safeOpen).toHaveAccessibleDescription(STARTUP_COPY_FALLBACKS.safeOpenNotice);
      expect(
        screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
      ).not.toBeInTheDocument();

      safeOpen.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => expect(onSafeOpen).toHaveBeenCalledOnce());
      expect(onRetry).not.toHaveBeenCalled();
      expect(onRecover).not.toHaveBeenCalled();
      expect(onReset).not.toHaveBeenCalled();
    },
  );

  it('keeps Safe Open busy while starting and clears it if startup re-renders the same screen', async () => {
    const user = userEvent.setup();
    let finishStartup: () => void = () => undefined;
    const onSafeOpen = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishStartup = resolve;
        }),
    );
    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-unsupported"
        onSafeOpen={onSafeOpen}
      />,
    );
    const safeOpen = screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.safeOpen });

    await user.click(safeOpen);
    await user.click(safeOpen);
    expect(safeOpen).toBeDisabled();
    expect(onSafeOpen).toHaveBeenCalledOnce();

    finishStartup();
    await waitFor(() => expect(safeOpen).toBeEnabled());
  });

  it('logs a sanitized error and re-enables Safe Open when the continuation itself fails', async () => {
    const user = userEvent.setup();
    const onSafeOpen = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-migration-gap"
        onSafeOpen={onSafeOpen}
      />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.safeOpen }));

    await waitFor(() =>
      expect(loggerError).toHaveBeenCalledWith('Safe open failed', { error: 'boom' }),
    );
    expect(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.safeOpen })).toBeEnabled();
  });

  it('never shows Safe Open for corrupt, I/O, or storage failures, or without a continuation', () => {
    const onSafeOpen = vi.fn();
    const { rerender } = render(
      <StorageErrorScreen
        copy={STARTUP_COPY_FALLBACKS}
        failureKind="project-corrupt"
        onSafeOpen={onSafeOpen}
      />,
    );
    for (const failureKind of ['project-io', 'storage'] as const) {
      rerender(
        <StorageErrorScreen
          copy={STARTUP_COPY_FALLBACKS}
          failureKind={failureKind}
          onSafeOpen={onSafeOpen}
        />,
      );
    }
    rerender(
      <StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} failureKind="project-unsupported" />,
    );

    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.safeOpen }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(STARTUP_COPY_FALLBACKS.safeOpenNotice)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.retry })).toBeInTheDocument();
  });
});
