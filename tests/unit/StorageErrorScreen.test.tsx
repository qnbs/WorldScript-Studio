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
      recover: 'Localized preserve',
      recoveryFailed: 'Localized safe failure',
    };

    render(<StorageErrorScreen copy={copy} onRecover={onRecover} />);
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

  it('announces recovery and blocks destructive reset while preservation is pending', async () => {
    const user = userEvent.setup();
    let resolveRecovery: () => void = () => undefined;
    const onRecover = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const onReset = vi.fn();

    render(
      <StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} onRecover={onRecover} onReset={onReset} />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));

    expect(screen.getByRole('status')).toHaveTextContent(STARTUP_COPY_FALLBACKS.recovering);
    expect(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.reset })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }));
    expect(onReset).not.toHaveBeenCalled();

    resolveRecovery();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('keeps source-missing wording truthful when preservation cannot be confirmed', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn().mockRejectedValue(new ProjectQuarantineError('source-missing'));

    render(<StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} onRecover={onRecover} />);

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));

    expect(await screen.findByText(STARTUP_COPY_FALLBACKS.recoveryUnknown)).toBeInTheDocument();
    expect(screen.queryByText(STARTUP_COPY_FALLBACKS.recoveryFailed)).not.toBeInTheDocument();
  });

  it('reports the typed already-preserved outcome and supports successful recovery and reset actions', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn().mockRejectedValue(new ProjectQuarantineError('already-preserved'));
    const onReset = vi.fn();
    const firstRender = render(
      <StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} onRecover={onRecover} onReset={onReset} />,
    );

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));
    expect(
      await screen.findByText(STARTUP_COPY_FALLBACKS.recoveryAlreadyPreserved),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }));
    expect(onReset).toHaveBeenCalledOnce();

    firstRender.unmount();
    const successfulRecover = vi.fn().mockResolvedValue(undefined);
    render(<StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} onRecover={successfulRecover} />);
    await user.click(screen.getByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }));
    await waitFor(() => expect(successfulRecover).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();
  });

  it('omits unsupported recovery actions when no handlers are provided', () => {
    render(<StorageErrorScreen copy={STARTUP_COPY_FALLBACKS} />);

    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.recover }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: STARTUP_COPY_FALLBACKS.reset }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(STARTUP_COPY_FALLBACKS.storageUnavailable)).toBeInTheDocument();
  });
});
