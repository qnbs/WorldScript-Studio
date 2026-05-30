/**
 * Tests for components/settings/PassphraseModal.tsx
 * QNBS-v3: Covers set/change/disable modes — validation, field visibility, onConfirm/onClose.
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

vi.mock('../../../components/ui/Button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({
    children,
    title,
    isOpen,
  }: {
    children: React.ReactNode;
    title: string;
    isOpen: boolean;
  }) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PassphraseModal } from '../../../components/settings/PassphraseModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// QNBS-v3: typed vi.fn() prevents Mock<Constructable|Procedure> vs Mock<Procedure> TS2345
type OnConfirm = (current: string, next: string) => Promise<void>;
type OnClose = () => void;

const makeProps = (
  mode: 'set' | 'change' | 'disable',
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

  it('shows wrong passphrase error when onConfirm rejects', async () => {
    onConfirm.mockRejectedValue(new Error('wrong'));
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
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionWrongPassphrase',
      ),
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

// ---------------------------------------------------------------------------
// Tests: change mode
// ---------------------------------------------------------------------------

describe('PassphraseModal — change mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('renders change title', () => {
    render(<PassphraseModal {...makeProps('change', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalChangeTitle')).toBeInTheDocument();
  });

  it('renders current passphrase field in change mode', () => {
    render(<PassphraseModal {...makeProps('change', onConfirm, onClose)} />);
    expect(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).toBeInTheDocument();
  });

  it('renders new and confirm fields in change mode', () => {
    render(<PassphraseModal {...makeProps('change', onConfirm, onClose)} />);
    expect(screen.getByLabelText('settings.privacy.encryptionNewPassphrase')).toBeInTheDocument();
    expect(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
    ).toBeInTheDocument();
  });

  it('calls onConfirm with current and new passphrase', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('change', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'oldpassword',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionNewPassphrase'),
      'newpassword1',
    );
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionConfirmPassphrase'),
      'newpassword1',
    );
    await user.click(screen.getByText('settings.privacy.encryptionChangeButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('oldpassword', 'newpassword1'));
  });
});

// ---------------------------------------------------------------------------
// Tests: disable mode
// ---------------------------------------------------------------------------

describe('PassphraseModal — disable mode', () => {
  let onClose: Mock<OnClose>;
  let onConfirm: Mock<OnConfirm>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn<OnClose>();
    onConfirm = vi.fn<OnConfirm>().mockResolvedValue(undefined) as Mock<OnConfirm>;
  });

  it('renders disable title', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(screen.getByText('settings.privacy.encryptionModalDisableTitle')).toBeInTheDocument();
  });

  it('shows current passphrase field in disable mode', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
    ).toBeInTheDocument();
  });

  it('does not show new or confirm fields in disable mode', () => {
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    expect(
      screen.queryByLabelText('settings.privacy.encryptionNewPassphrase'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('settings.privacy.encryptionConfirmPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('calls onConfirm with current passphrase and empty next on disable', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'mypassword',
    );
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('mypassword', ''));
  });

  it('calls onClose after successful disable', async () => {
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'mypassword',
    );
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows error when onConfirm rejects in disable mode', async () => {
    onConfirm.mockRejectedValue(new Error('wrong'));
    const user = userEvent.setup();
    render(<PassphraseModal {...makeProps('disable', onConfirm, onClose)} />);
    await user.type(
      screen.getByLabelText('settings.privacy.encryptionCurrentPassphrase'),
      'wrongpass',
    );
    await user.click(screen.getByText('settings.privacy.encryptionDisableButton'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'settings.privacy.encryptionWrongPassphrase',
      ),
    );
  });
});
