/**
 * Tests for components/settings/PassphraseModal.tsx
 * QNBS-v3: Covers the supported set/unlock modes — validation, field visibility, onConfirm/onClose.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

const mockLoggerWarn = vi.fn();
vi.mock('../../../services/logger', () => ({
  logger: { warn: (...args: unknown[]) => mockLoggerWarn(...args) },
}));

// QNBS-v3: IdbWrongPassphraseError must be a real class (not a plain mock) so the component's
// `err instanceof IdbWrongPassphraseError` check works the same way it does against the real
// module — vi.hoisted() is required because vi.mock factories run before ordinary top-level
// `class`/`const` initializers execute.
const { MockIdbWrongPassphraseError } = vi.hoisted(() => ({
  MockIdbWrongPassphraseError: class extends Error {},
}));
vi.mock('../../../services/storage/storageEncryptionService', () => ({
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
      // QNBS-v3 (CodeRabbit #342): expose isDismissible so tests can assert the modal blocks
      // dismissal while a disable/rotate migration is running (busy).
      <div role="dialog" data-dismissible={String(isDismissible)}>
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  PassphraseModal,
  type PassphraseModalMode,
} from '../../../components/settings/PassphraseModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// QNBS-v3: typed vi.fn() prevents Mock<Constructable|Procedure> vs Mock<Procedure> TS2345
type OnConfirm = (current: string, next: string) => Promise<void>;
type OnClose = () => void;

const makeProps = (
  mode: PassphraseModalMode,
  onConfirm: Mock<OnConfirm> = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>,
  onClose: Mock<OnClose> = vi.fn<OnClose>(),
) => ({ mode, onConfirm, onClose });

// ---------------------------------------------------------------------------
// Tests: set mode
// ---------------------------------------------------------------------------

describe('PassphraseModal — set mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('is dismissible while idle (not busy)', () => {
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dismissible', 'true');
  });

  it('renders set title', () => {
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalSetTitle')).toBeInTheDocument();
  });

  it('does not render current passphrase field in set mode', () => {
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    expect(
      screen.queryByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('renders new passphrase and confirm fields', () => {
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    expect(screen.getByLabelText('settings.privacy.encryptionNewPassphrase')).toBeInTheDocument();
    expect(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
    ).toBeInTheDocument();
  });

  it('shows too-short error when new passphrase < 8 chars', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionNewPassphrase'), 'short');
    await user.type(screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'), 'short');
    await user.click(screen.getByText('settings.privacy.encryptionSetButton'));
    expect(screen.getByRole('alert')).toHaveTextContent('settings.privacy.encryptionTooShort');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows mismatch error when new and confirm differ', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'longpassword1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'longpassword2',
    );
    await user.click(screen.getByText('settings.privacy.encryptionSetButton'));
    expect(screen.getByRole('alert')).toHaveTextContent('settings.privacy.encryptionMismatch');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm and onClose on valid set', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'validpass1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'validpass1',
    );
    await user.click(screen.getByText('settings.privacy.encryptionSetButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('', 'validpass1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a setup-failed error (not wrong-passphrase) when onConfirm rejects', async () => {
    // QNBS-v3: 'set' mode has no prior passphrase to be "wrong" — a rejection here is always a
    // storage/salt failure, so it must not show the wrong-passphrase message.
    onConfirm.mockRejectedValue(new Error('storage blocked'));
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'validpass1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'validpass1',
    );
    await user.click(screen.getByText('settings.privacy.encryptionSetButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('settings.privacy.encryptionSetupFailed'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel button calls onClose', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('set', onConfirm, onClose)} />);
    await user.click(screen.getByText('common.cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PassphraseModal — unlock mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('renders unlock title', () => {
    render(<PassphraseModal {...makeProps('unlock', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalUnlockTitle')).toBeInTheDocument();
  });

  it('shows the current passphrase field without new-passphrase fields', () => {
    render(<PassphraseModal {...makeProps('unlock', onConfirm, onClose)} />);
    expect(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).toBeInTheDocument();
  });

  it('does not show new or confirm fields', () => {
    render(<PassphraseModal {...makeProps('unlock', onConfirm, onClose)} />);
    expect(
      screen.queryByLabelText('settings.privacy.encryptionNewPassphrase'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('settings.privacy.encryptionConfirmPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('calls onConfirm with current passphrase and empty next value', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('unlock', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'mypassword',
    );
    await user.click(screen.getByText('settings.privacy.encryptionUnlockButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('mypassword', ''));
  });

  it('shows a wrong-passphrase error when unlock fails on a credential mismatch', async () => {
    onConfirm.mockRejectedValue(new MockIdbWrongPassphraseError());
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('unlock', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'wrongpass',
    );
    await user.click(screen.getByText('settings.privacy.encryptionUnlockButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionWrongPassphrase',
      ),
    );
  });
});

describe('PassphraseModal — disable mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('renders the disable title', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalDisableTitle')).toBeInTheDocument();
  });

  it('renders no passphrase input fields — clearIdbPassphrase() requires an already-unlocked session', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(
      screen.queryByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('settings.privacy.encryptionNewPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('shows the disable confirmation warning, not the forgot-passphrase warning', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionDisableConfirm')).toBeInTheDocument();
    expect(screen.queryByText('settings.privacy.encryptionWarning')).not.toBeInTheDocument();
  });

  it('calls onConfirm with empty args and onClose on success', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('', ''));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a disable-failed error (not wrong-passphrase) when onConfirm rejects', async () => {
    onConfirm.mockRejectedValue(new Error('migration failed'));
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionDisableFailed',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows live migration progress while the confirm promise is pending', async () => {
    let resolveConfirm: (() => void) | undefined;
    onConfirm.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(
      <PassphraseModal {...makeProps('disable', onConfirm, onClose)} progress={null} />,
    );
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());

    rerender(
      <PassphraseModal
        {...makeProps('disable', onConfirm, onClose)}
        progress={{
          storeId: 'store-a',
          storeIndex: 1,
          storeCount: 4,
          phase: 'migrating',
          processed: 10,
        }}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(
      screen.getByText('settings.privacy.encryptionMigrationProgress', { exact: false }),
    ).toBeInTheDocument();
    // QNBS-v3 (CodeRabbit #342): the modal must block dismissal while the migration is running.
    expect(screen.getByRole('dialog')).toHaveAttribute('data-dismissible', 'false');

    resolveConfirm?.();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('PassphraseModal — rotate mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('renders the change-passphrase title', () => {
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalChangeTitle')).toBeInTheDocument();
  });

  it('renders current, new, and confirm passphrase fields', () => {
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    expect(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('settings.privacy.encryptionNewPassphrase')).toBeInTheDocument();
    expect(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
    ).toBeInTheDocument();
  });

  it('shows too-short error when new passphrase < 8 chars', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'), 'old');
    await user.type(screen.getByLabelText('settings.privacy.encryptionNewPassphrase'), 'short');
    await user.type(screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'), 'short');
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    expect(screen.getByRole('alert')).toHaveTextContent('settings.privacy.encryptionTooShort');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows mismatch error when new and confirm differ', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'), 'old');
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'longpassword1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'longpassword2',
    );
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    expect(screen.getByRole('alert')).toHaveTextContent('settings.privacy.encryptionMismatch');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm with (current, next) and onClose on valid rotate', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'oldpass1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'newpass123',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'newpass123',
    );
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('oldpass1', 'newpass123'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a wrong-passphrase error when onConfirm rejects with a credential mismatch', async () => {
    onConfirm.mockRejectedValue(new MockIdbWrongPassphraseError());
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'), 'wrong');
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'newpass123',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'newpass123',
    );
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionWrongPassphrase',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // QNBS-v3 (CodeRabbit #342): rotateIdbPassphrase can also fail after old-passphrase verification
  // succeeded — an active/recovery-required journal or a store migration failure — which must not
  // be misreported as a wrong-passphrase error (it would send the user to retype a correct
  // passphrase instead of towards the actual recovery/migration problem).
  it('shows a generic recovery-failed error (not wrong-passphrase) for a non-credential migration failure', async () => {
    onConfirm.mockRejectedValue(new Error('a migration is already active'));
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('rotate', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'correctpass',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'newpass123',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'newpass123',
    );
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionRecoveryFailed',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'PassphraseModal rotate failed',
      expect.objectContaining({ error: 'a migration is already active' }),
    );
  });
});
