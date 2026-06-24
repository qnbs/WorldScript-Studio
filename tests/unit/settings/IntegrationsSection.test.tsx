/**
 * Tests for components/settings/IntegrationsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + languageToolClient; tests LT toggle, base URL, ping.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
}));

const mockLanguageToolPing = vi.fn().mockResolvedValue(true);
const mockAssertLanguageToolAllowed = vi.fn();

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      integrations: {
        languageToolEnabled: true,
        languageToolBaseUrl: 'http://localhost:8081',
      },
      privacy: { allowCloudServices: true },
    },
    handleSettingChange: mockHandleSettingChange,
  }),
}));

vi.mock('../../../services/languageToolClient', () => ({
  languageToolPing: (...args: unknown[]) => mockLanguageToolPing(...args),
  assertLanguageToolAllowed: (...args: unknown[]) => mockAssertLanguageToolAllowed(...args),
}));

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({ children, value, onChange, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
      <select value={value} onChange={onChange} {...rest}>
        {children}
      </select>
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { IntegrationsSection } from '../../../components/settings/IntegrationsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // QNBS-v3: the dead sync/import card (with the generic title) was removed; LanguageTool is the
  // section's only real integration now.
  it('renders the LanguageTool title', () => {
    render(<IntegrationsSection />);
    expect(screen.getByText('settings.integrations.languageToolTitle')).toBeInTheDocument();
  });

  it('renders the LanguageTool enabled toggle', () => {
    render(<IntegrationsSection />);
    expect(screen.getByText('settings.integrations.languageToolEnable')).toBeInTheDocument();
  });

  it('renders the base URL input', () => {
    render(<IntegrationsSection />);
    const input = screen.getByDisplayValue('http://localhost:8081');
    expect(input).toBeInTheDocument();
  });

  it('renders the test connection button', () => {
    render(<IntegrationsSection />);
    expect(screen.getByText('settings.integrations.languageToolTest')).toBeInTheDocument();
  });

  it('calls languageToolPing when test button is clicked', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection />);
    await user.click(screen.getByText('settings.integrations.languageToolTest'));
    await waitFor(() => expect(mockLanguageToolPing).toHaveBeenCalledWith('http://localhost:8081'));
  });

  it('shows success message after successful ping', async () => {
    const user = userEvent.setup();
    mockLanguageToolPing.mockResolvedValue(true);
    render(<IntegrationsSection />);
    await user.click(screen.getByText('settings.integrations.languageToolTest'));
    await waitFor(() =>
      expect(screen.getByText('settings.integrations.languageToolTestOk')).toBeInTheDocument(),
    );
  });

  it('shows fail message after failed ping', async () => {
    const user = userEvent.setup();
    mockLanguageToolPing.mockResolvedValue(false);
    render(<IntegrationsSection />);
    await user.click(screen.getByText('settings.integrations.languageToolTest'));
    await waitFor(() =>
      expect(screen.getByText('settings.integrations.languageToolTestFail')).toBeInTheDocument(),
    );
  });

  it('shows error message when ping throws', async () => {
    const user = userEvent.setup();
    mockLanguageToolPing.mockRejectedValue(new Error('Connection refused'));
    render(<IntegrationsSection />);
    await user.click(screen.getByText('settings.integrations.languageToolTest'));
    await waitFor(() => expect(screen.getByText('Connection refused')).toBeInTheDocument());
  });
});
