/**
 * Tests for components/settings/EncryptionRecoveryModal.tsx
 * QNBS-v3: Covers disable/rekey resume flows, the non-resumable 'recovery-required' stuck state,
 *          field visibility per operation, live migration progress, and error handling.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EncryptionMigrationJournal } from '../../../services/storage/encryptionMigrationJournal';

// QNBS-v3: typed vi.fn() prevents Mock<Constructable|Procedure> vs Mock<Procedure> TS2345
type OnRecovered = () => void;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockResumeEncryptionMigration = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockWipeAllAppData = vi.fn();

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../services/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

vi.mock('../../../services/factoryResetService', () => ({
  wipeAllAppData: (...args: unknown[]) => mockWipeAllAppData(...args),
}));

// QNBS-v3: IdbWrongPassphraseError must be a real class (not a plain mock) so the component's
// `err instanceof IdbWrongPassphraseError` check works the same way it does against the real
// module — vi.hoisted() is required here (unlike the plain vi.fn() consts above) because vi.mock
// factories run before ordinary top-level `class`/`const` initializers execute.
const { MockIdbWrongPassphraseError } = vi.hoisted(() => ({
  MockIdbWrongPassphraseError: class extends Error {},
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  resumeEncryptionMigration: (...args: unknown[]) => mockResumeEncryptionMigration(...args),
  IdbWrongPassphraseError: MockIdbWrongPassphraseError,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({
    children,
    title,
    isOpen,
    isDismissible,
  }: {
    children: React.ReactNode;
    title: string;
    isOpen: boolean;
    isDismissible?: boolean;
  }) =>
    isOpen ? (
      // QNBS-v3 (CodeRabbit #342): expose isDismissible on the dialog so tests can assert the
      // recovery modal stays non-dismissible — a regression that flips it would fail these tests.
      <div role="dialog" data-dismissible={String(isDismissible)}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { EncryptionRecoveryModal } from '../../../components/settings/EncryptionRecoveryModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJournal(
  overrides: Partial<EncryptionMigrationJournal> = {},
): EncryptionMigrationJournal {
  return {
    schemaVersion: 1,
    operationId: 'test-op',
    revision: 3,
    operation: 'disable',
    phase: 'migrating',
    startedAt: 0,
    updatedAt: 0,
    stores: [{ id: 'store-a', processed: 5, verified: 0, done: false }],
    ...overrides,
  };
}

describe('EncryptionRecoveryModal', () => {
  let onRecovered: Mock<OnRecovered>;

  beforeEach(() => {
    vi.clearAllMocks();
    onRecovered = vi.fn<OnRecovered>();
    mockWipeAllAppData.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the recovery title', () => {
    render(<EncryptionRecoveryModal journal={makeJournal()} onRecovered={onRecovered} />);
    expect(screen.getByText('settings.privacy.encryptionRecoveryTitle')).toBeInTheDocument();
  });

  // QNBS-v3 (CodeRabbit #342): an unfinished migration must keep the recovery modal
  // non-dismissible — a regression that makes it dismissible would let a user abandon a
  // migration mid-way (see issue #350 for the deliberate, separate "forgot passphrase" escape hatch).
  it('is not dismissible while recovery is pending', () => {
    render(<EncryptionRecoveryModal journal={makeJournal()} onRecovered={onRecovered} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dismissible', 'false');
  });

  it('shows the disable-specific body text for a disable operation', () => {
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'disable' })}
        onRecovered={onRecovered}
      />,
    );
    expect(screen.getByText('settings.privacy.encryptionRecoveryBodyDisable')).toBeInTheDocument();
  });

  it('shows the rotate-specific body text for a rekey operation', () => {
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'rekey', targetVerifier: [1, 2, 3] })}
        onRecovered={onRecovered}
      />,
    );
    expect(screen.getByText('settings.privacy.encryptionRecoveryBodyRotate')).toBeInTheDocument();
  });

  it('shows only the source passphrase field for a disable operation', () => {
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'disable' })}
        onRecovered={onRecovered}
      />,
    );
    expect(screen.getByLabelText('settings.privacy.encryptionPassphrase')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('settings.privacy.encryptionNewPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('shows both source and new passphrase fields for a rekey operation', () => {
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'rekey', targetVerifier: [1, 2, 3] })}
        onRecovered={onRecovered}
      />,
    );
    expect(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('settings.privacy.encryptionNewPassphrase')).toBeInTheDocument();
  });

  it('shows the stuck message and no input fields for a recovery-required journal', () => {
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ phase: 'recovery-required' })}
        onRecovered={onRecovered}
      />,
    );
    expect(screen.getByText('settings.privacy.encryptionRecoveryStuck')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('settings.privacy.encryptionPassphrase'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'settings.data.dangerZone.factoryReset.button' }),
    ).toBeInTheDocument();
  });

  it('disables the resume button until the required fields are filled', async () => {
    const user = userEvent.setup();
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'rekey', targetVerifier: [1, 2, 3] })}
        onRecovered={onRecovered}
      />,
    );
    const resumeButton = screen.getByText('settings.privacy.encryptionRecoveryResumeButton');
    expect(resumeButton).toBeDisabled();

    await user.type(screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'), 'old');
    expect(resumeButton).toBeDisabled();

    await user.type(screen.getByLabelText('settings.privacy.encryptionNewPassphrase'), 'newpass');
    expect(resumeButton).not.toBeDisabled();
  });

  it('calls resumeEncryptionMigration with only the source passphrase for disable, then onRecovered', async () => {
    mockResumeEncryptionMigration.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const journal = makeJournal({ operation: 'disable' });
    render(<EncryptionRecoveryModal journal={journal} onRecovered={onRecovered} />);

    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'mypass');
    await user.click(screen.getByText('settings.privacy.encryptionRecoveryResumeButton'));

    await waitFor(() =>
      expect(mockResumeEncryptionMigration).toHaveBeenCalledWith(
        journal,
        { sourcePassphrase: 'mypass' },
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
  });

  it('calls resumeEncryptionMigration with both passphrases for rekey', async () => {
    mockResumeEncryptionMigration.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const journal = makeJournal({ operation: 'rekey', targetVerifier: [1, 2, 3] });
    render(<EncryptionRecoveryModal journal={journal} onRecovered={onRecovered} />);

    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'oldpass',
    );
    await user.type(screen.getByLabelText('settings.privacy.encryptionNewPassphrase'), 'newpass');
    await user.click(screen.getByText('settings.privacy.encryptionRecoveryResumeButton'));

    await waitFor(() =>
      expect(mockResumeEncryptionMigration).toHaveBeenCalledWith(
        journal,
        { sourcePassphrase: 'oldpass', targetPassphrase: 'newpass' },
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
  });

  it('shows a wrong-passphrase error and does not call onRecovered when the passphrase is wrong', async () => {
    mockResumeEncryptionMigration.mockRejectedValue(new MockIdbWrongPassphraseError());
    const user = userEvent.setup();
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'disable' })}
        onRecovered={onRecovered}
      />,
    );

    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'wrongpass');
    await user.click(screen.getByText('settings.privacy.encryptionRecoveryResumeButton'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionWrongPassphrase',
      ),
    );
    expect(onRecovered).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // QNBS-v3 (CodeRabbit #342): a non-credential failure (missing verifier, invalid journal
  // operation, migration/adapter error) must show a distinct message, not a misleading
  // "wrong passphrase" one, and should be logged for diagnostics.
  it('shows a generic recovery-failed error (not wrong-passphrase) for a non-credential failure', async () => {
    mockResumeEncryptionMigration.mockRejectedValue(new Error('journal is missing its verifier'));
    const user = userEvent.setup();
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'disable' })}
        onRecovered={onRecovered}
      />,
    );

    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'anything');
    await user.click(screen.getByText('settings.privacy.encryptionRecoveryResumeButton'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionRecoveryFailed',
      ),
    );
    expect(onRecovered).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Encryption recovery resume failed',
      expect.objectContaining({ error: 'journal is missing its verifier' }),
    );
  });

  it('reports live migration progress via the onProgress callback while resuming', async () => {
    let progressCallback: ((progress: unknown) => void) | undefined;
    let resolveResume: (() => void) | undefined;
    mockResumeEncryptionMigration.mockImplementation(
      (_journal: unknown, _input: unknown, onProgress: (progress: unknown) => void) => {
        progressCallback = onProgress;
        return new Promise<void>((resolve) => {
          resolveResume = resolve;
        });
      },
    );
    const user = userEvent.setup();
    render(
      <EncryptionRecoveryModal
        journal={makeJournal({ operation: 'disable' })}
        onRecovered={onRecovered}
      />,
    );

    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'mypass');
    await user.click(screen.getByText('settings.privacy.encryptionRecoveryResumeButton'));
    await waitFor(() => expect(progressCallback).toBeDefined());

    progressCallback?.({ storeId: 'store-a', storeIndex: 2, storeCount: 4, phase: 'migrating' });
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50'),
    );

    resolveResume?.();
    await waitFor(() => expect(onRecovered).toHaveBeenCalledTimes(1));
  });

  describe('danger-zone factory reset', () => {
    it('asks for confirmation and wipes app data from the stuck (recovery-required) state', async () => {
      const user = userEvent.setup();
      render(
        <EncryptionRecoveryModal
          journal={makeJournal({ phase: 'recovery-required' })}
          onRecovered={onRecovered}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'settings.data.dangerZone.factoryReset.button' }),
      );
      expect(window.confirm).toHaveBeenCalledWith(
        'settings.data.dangerZone.factoryReset.modalWarning',
      );
      await waitFor(() => expect(mockWipeAllAppData).toHaveBeenCalledTimes(1));
    });

    it('asks for confirmation and wipes app data from the normal resume state', async () => {
      const user = userEvent.setup();
      render(
        <EncryptionRecoveryModal
          journal={makeJournal({ operation: 'disable' })}
          onRecovered={onRecovered}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'settings.data.dangerZone.factoryReset.button' }),
      );
      await waitFor(() => expect(mockWipeAllAppData).toHaveBeenCalledTimes(1));
    });

    it('does not wipe app data when the confirmation is dismissed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      render(
        <EncryptionRecoveryModal
          journal={makeJournal({ phase: 'recovery-required' })}
          onRecovered={onRecovered}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'settings.data.dangerZone.factoryReset.button' }),
      );
      expect(mockWipeAllAppData).not.toHaveBeenCalled();
    });

    it('shows a recovery-failed error and logs it when wipeAllAppData rejects', async () => {
      mockWipeAllAppData.mockRejectedValue(new Error('disk full'));
      const user = userEvent.setup();
      render(
        <EncryptionRecoveryModal
          journal={makeJournal({ phase: 'recovery-required' })}
          onRecovered={onRecovered}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'settings.data.dangerZone.factoryReset.button' }),
      );
      await waitFor(() =>
        expect(
          screen.getByText('settings.data.dangerZone.factoryReset.failed'),
        ).toBeInTheDocument(),
      );
      expect(mockLoggerError).toHaveBeenCalledWith('Factory reset failed', { error: 'disk full' });
    });
  });
});
