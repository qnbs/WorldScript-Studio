/**
 * Tests for components/settings/NotificationsSection.tsx
 * QNBS-v3: Mocks SettingsViewContext; tests 4 toggle switches + writing reminders select.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHandleSettingChange = vi.fn();

let mockSettings = {
  notifications: {
    desktopNotifications: true,
    emailNotifications: false,
    goalAchievements: true,
    collaborationUpdates: false,
    writingReminders: 'daily',
  },
};

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
    settings: mockSettings,
    handleSettingChange: mockHandleSettingChange,
  }),
}));

vi.mock('../../../components/ui/Select', () => ({
  Select: vi.fn(
    ({
      value,
      onChange,
      options,
      groups,
      ariaLabel,
      ...rest
    }: {
      value: string;
      onChange: (v: string) => void;
      options?: Array<{ value: string; label: string; disabled?: boolean }>;
      groups?: Array<{
        label: string;
        options: Array<{ value: string; label: string; disabled?: boolean }>;
      }>;
      ariaLabel?: string;
      [key: string]: unknown;
    }) => (
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      >
        {(options ?? groups?.flatMap((g) => g.options) ?? []).map(
          (opt: { value: string; label: string; disabled?: boolean }) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ),
        )}
      </select>
    ),
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { NotificationsSection } from '../../../components/settings/NotificationsSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings = {
      notifications: {
        desktopNotifications: true,
        emailNotifications: false,
        goalAchievements: true,
        collaborationUpdates: false,
        writingReminders: 'daily',
      },
    };
  });

  it('renders the notifications title', () => {
    render(<NotificationsSection />);
    expect(screen.getByText('settings.notifications.title')).toBeInTheDocument();
  });

  it('renders 4 toggle switches', () => {
    render(<NotificationsSection />);
    // QNBS-v3: ToggleSwitch uses role="switch", not role="checkbox"
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(4);
  });

  it('desktop notifications toggle reflects current setting', () => {
    render(<NotificationsSection />);
    const switches = screen.getAllByRole('switch');
    expect(switches[0]).toBeChecked(); // desktopNotifications: true
  });

  it('email notifications toggle reflects current setting', () => {
    render(<NotificationsSection />);
    const switches = screen.getAllByRole('switch');
    expect(switches[1]).not.toBeChecked(); // emailNotifications: false
  });

  it('calls handleSettingChange when desktop toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationsSection />);
    const switches = screen.getAllByRole('switch');
    await user.click(switches[0] as HTMLElement);
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'notifications',
      expect.objectContaining({ desktopNotifications: false }),
    );
  });

  it('renders writing reminders select with current value', () => {
    render(<NotificationsSection />);
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('daily');
  });

  it('calls handleSettingChange when reminders select changes', async () => {
    const user = userEvent.setup();
    render(<NotificationsSection />);
    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'weekly');
    expect(mockHandleSettingChange).toHaveBeenCalledWith(
      'notifications',
      expect.objectContaining({ writingReminders: 'weekly' }),
    );
  });

  it('renders all reminder frequency options', () => {
    render(<NotificationsSection />);
    expect(screen.getByText('settings.notifications.frequency.never')).toBeInTheDocument();
    expect(screen.getByText('settings.notifications.frequency.daily')).toBeInTheDocument();
    expect(screen.getByText('settings.notifications.frequency.weekly')).toBeInTheDocument();
    expect(screen.getByText('settings.notifications.frequency.monthly')).toBeInTheDocument();
  });
});
