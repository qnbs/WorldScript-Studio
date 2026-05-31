/**
 * Tests for components/settings/IdbUnlockModal.tsx
 * QNBS-v3: Mocks verifyAndInitIdbEncryption; covers unlock flow, wrong-passphrase error,
 *          Enter-key shortcut, and the forgot-passphrase escape hatch.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyAndInit = vi.fn();

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

vi.mock('../../../services/storage/storageEncryptionService', () => ({
  verifyAndInitIdbEncryption: (...args: unknown[]) => mockVerifyAndInit(...args),
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('../../../components/ui/Modal', () => ({
  // QNBS-v3: minimal Modal stub — renders children + title only; avoids focus-trap setup in jsdom
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

import { IdbUnlockModal } from '../../../components/settings/IdbUnlockModal';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdbUnlockModal', () => {
  const mockOnUnlocked = vi.fn();
  const mockOnForgotPassphrase = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    mockVerifyAndInit.mockResolvedValue(undefined);
  });

  it('renders the unlock modal dialog', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders the title from i18n', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    expect(screen.getByText('settings.privacy.encryptionModalUnlockTitle')).toBeInTheDocument();
  });

  it('renders the passphrase input', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    expect(screen.getByLabelText('settings.privacy.encryptionPassphrase')).toBeInTheDocument();
  });

  it('passphrase input is of type password', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const input = screen.getByLabelText('settings.privacy.encryptionPassphrase');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('unlock button is disabled when passphrase is empty', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    // First button is the unlock button
    expect(screen.getAllByRole('button')[0]).toBeDisabled();
  });

  it('unlock button is enabled after typing a passphrase', async () => {
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'secret123');
    expect(screen.getAllByRole('button')[0]).not.toBeDisabled();
  });

  it('calls verifyAndInitIdbEncryption with the entered passphrase on click', async () => {
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'mypassword');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => expect(mockVerifyAndInit).toHaveBeenCalledWith('mypassword'));
  });

  it('calls onUnlocked after successful verifyAndInitIdbEncryption', async () => {
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'mypassword');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => expect(mockOnUnlocked).toHaveBeenCalledTimes(1));
  });

  it('shows error message when verifyAndInitIdbEncryption rejects', async () => {
    mockVerifyAndInit.mockRejectedValue(new Error('wrong key'));
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'wrongpass');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('settings.privacy.encryptionWrongPassphrase')).toBeInTheDocument();
    });
  });

  it('does not call onUnlocked when verifyAndInitIdbEncryption rejects', async () => {
    mockVerifyAndInit.mockRejectedValue(new Error('wrong key'));
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'wrongpass');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => expect(mockVerifyAndInit).toHaveBeenCalled());
    expect(mockOnUnlocked).not.toHaveBeenCalled();
  });

  it('shows rate-limit message after 4 failed attempts', async () => {
    mockVerifyAndInit.mockRejectedValue(new Error('wrong key'));
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const input = screen.getByLabelText('settings.privacy.encryptionPassphrase');
    for (let i = 0; i < 4; i++) {
      await user.type(input, 'wrong', { initialSelectionStart: 0, initialSelectionEnd: 100 });
      await user.click(screen.getAllByRole('button')[0] as HTMLElement);
      await waitFor(() => expect(mockVerifyAndInit).toHaveBeenCalledTimes(i + 1));
    }
    await waitFor(() => {
      expect(screen.getByText(/settings.privacy.encryptionTooManyAttempts/)).toBeInTheDocument();
    });
  });

  it('disables unlock button during rate-limit lockout', async () => {
    mockVerifyAndInit.mockRejectedValue(new Error('wrong key'));
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const input = screen.getByLabelText('settings.privacy.encryptionPassphrase');
    for (let i = 0; i < 4; i++) {
      await user.type(input, 'wrong', { initialSelectionStart: 0, initialSelectionEnd: 100 });
      await user.click(screen.getAllByRole('button')[0] as HTMLElement);
      await waitFor(() => expect(mockVerifyAndInit).toHaveBeenCalledTimes(i + 1));
    }
    await waitFor(() => {
      expect(screen.getAllByRole('button')[0]).toBeDisabled();
    });
  });

  it('resets attempt count after successful unlock', async () => {
    mockVerifyAndInit.mockRejectedValueOnce(new Error('wrong key'));
    mockVerifyAndInit.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const input = screen.getByLabelText('settings.privacy.encryptionPassphrase');
    await user.type(input, 'wrong');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText('settings.privacy.encryptionWrongPassphrase')).toBeInTheDocument(),
    );
    await user.type(input, 'correct', { initialSelectionStart: 0, initialSelectionEnd: 100 });
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => expect(mockOnUnlocked).toHaveBeenCalledTimes(1));
    // After success, attempts should be reset — another wrong attempt should show normal error, not rate-limit
    mockVerifyAndInit.mockRejectedValue(new Error('wrong key'));
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const newInput = screen.getAllByLabelText(
      'settings.privacy.encryptionPassphrase',
    )[0] as HTMLElement;
    await user.type(newInput, 'wrongagain');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('settings.privacy.encryptionWrongPassphrase')).toBeInTheDocument();
    });
  });

  it('clears error when passphrase changes after a failed attempt', async () => {
    mockVerifyAndInit.mockRejectedValueOnce(new Error('wrong key'));
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    const input = screen.getByLabelText('settings.privacy.encryptionPassphrase');
    await user.type(input, 'wrong');
    await user.click(screen.getAllByRole('button')[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText('settings.privacy.encryptionWrongPassphrase')).toBeInTheDocument(),
    );
    await user.type(input, 'x');
    expect(
      screen.queryByText('settings.privacy.encryptionWrongPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('submits on Enter key press', async () => {
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.type(screen.getByLabelText('settings.privacy.encryptionPassphrase'), 'passphrase');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mockVerifyAndInit).toHaveBeenCalledWith('passphrase'));
  });

  it('does not call verifyAndInitIdbEncryption on Enter with empty passphrase', async () => {
    const user = userEvent.setup();
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    await user.keyboard('{Enter}');
    expect(mockVerifyAndInit).not.toHaveBeenCalled();
  });

  // ── Forgot passphrase escape hatch ─────────────────────────────────────────

  it('does not show forgot-passphrase button when onForgotPassphrase prop is absent', () => {
    render(<IdbUnlockModal onUnlocked={mockOnUnlocked} />);
    expect(
      screen.queryByText('settings.privacy.encryptionForgotPassphrase'),
    ).not.toBeInTheDocument();
  });

  it('shows forgot-passphrase link when onForgotPassphrase prop is provided', () => {
    render(
      <IdbUnlockModal onUnlocked={mockOnUnlocked} onForgotPassphrase={mockOnForgotPassphrase} />,
    );
    expect(screen.getByText('settings.privacy.encryptionForgotPassphrase')).toBeInTheDocument();
  });

  it('shows confirmation UI after clicking forgot-passphrase link', async () => {
    const user = userEvent.setup();
    render(
      <IdbUnlockModal onUnlocked={mockOnUnlocked} onForgotPassphrase={mockOnForgotPassphrase} />,
    );
    await user.click(screen.getByText('settings.privacy.encryptionForgotPassphrase'));
    expect(
      screen.getByText('settings.privacy.encryptionForgotPassphraseWarning'),
    ).toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionDisableConfirm')).toBeInTheDocument();
    expect(screen.getByText('common.cancel')).toBeInTheDocument();
  });

  it('calls onForgotPassphrase when confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <IdbUnlockModal onUnlocked={mockOnUnlocked} onForgotPassphrase={mockOnForgotPassphrase} />,
    );
    await user.click(screen.getByText('settings.privacy.encryptionForgotPassphrase'));
    await user.click(screen.getByText('settings.privacy.encryptionDisableConfirm'));
    expect(mockOnForgotPassphrase).toHaveBeenCalledTimes(1);
  });

  it('does not call onForgotPassphrase when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <IdbUnlockModal onUnlocked={mockOnUnlocked} onForgotPassphrase={mockOnForgotPassphrase} />,
    );
    await user.click(screen.getByText('settings.privacy.encryptionForgotPassphrase'));
    await user.click(screen.getByText('common.cancel'));
    expect(mockOnForgotPassphrase).not.toHaveBeenCalled();
  });

  it('hides confirmation UI after cancel is clicked', async () => {
    const user = userEvent.setup();
    render(
      <IdbUnlockModal onUnlocked={mockOnUnlocked} onForgotPassphrase={mockOnForgotPassphrase} />,
    );
    await user.click(screen.getByText('settings.privacy.encryptionForgotPassphrase'));
    await user.click(screen.getByText('common.cancel'));
    expect(
      screen.queryByText('settings.privacy.encryptionForgotPassphraseWarning'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('settings.privacy.encryptionForgotPassphrase')).toBeInTheDocument();
  });
});
