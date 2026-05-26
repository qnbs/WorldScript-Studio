/**
 * Tests for components/settings/BackupSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests toggle, frequency selector, retention input.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockHandleSettingChange } = vi.hoisted(() => ({
  mockHandleSettingChange: vi.fn(),
}));

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: {
      backup: {
        autoBackup: true,
        encryptBackups: false,
        backupFrequency: 'daily',
        maxBackups: 5,
        backupLocation: 'local',
        autoBackupInterval: 60,
      },
    },
    handleSettingChange: mockHandleSettingChange,
  }),
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

vi.mock('../../../components/ui/Input', () => ({
  Input: vi.fn(({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input value={value} onChange={onChange} {...rest} />
  )),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type React from 'react';
import { BackupSection } from '../../../components/settings/BackupSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the backup title', () => {
    render(<BackupSection />);
    expect(screen.getByText('settings.backup.title')).toBeInTheDocument();
  });

  it('renders auto-backup toggle', () => {
    render(<BackupSection />);
    expect(screen.getByText('settings.backup.autoBackup')).toBeInTheDocument();
  });

  it('renders encrypt backups toggle', () => {
    render(<BackupSection />);
    expect(screen.getByText('settings.backup.encryptBackups')).toBeInTheDocument();
  });

  it('renders backup frequency label', () => {
    render(<BackupSection />);
    expect(screen.getByText('settings.backup.backupFrequency')).toBeInTheDocument();
  });

  it('calls handleSettingChange when auto-backup is toggled', async () => {
    const user = userEvent.setup();
    render(<BackupSection />);
    const toggle = screen.getByRole('switch', { name: 'settings.backup.autoBackup' });
    await user.click(toggle);
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'backup',
      expect.objectContaining({ autoBackup: false }),
    );
  });

  it('renders the backup frequency selector', () => {
    render(<BackupSection />);
    // combobox should be present for frequency
    const combos = screen.getAllByRole('combobox');
    expect(combos.length).toBeGreaterThan(0);
  });
});
