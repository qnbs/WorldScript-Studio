/**
 * Tests for components/ui/LanguageSelector.tsx
 * QNBS-v3: UI component with i18n integration
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from '../../components/ui/LanguageSelector';

// Mock useTranslation hook
const mockSetLanguage = vi.fn();
vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    language: 'en',
    setLanguage: mockSetLanguage,
  }),
}));

describe('LanguageSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('compact variant', () => {
    it('renders with current language flag and name', () => {
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="compact" />);
      expect(screen.getByRole('button', { name: 'portal.language.groupLabel' })).toBeTruthy();
    });

    it('shows beta indicator for beta languages', () => {
      render(<LanguageSelector value="ar" onChange={vi.fn()} variant="compact" />);
      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      expect(button).toBeTruthy();
      // Beta indicator should be present
      expect(button.querySelector('sup')).toBeTruthy();
    });
  });

  describe('full variant', () => {
    it('renders with current language selected', () => {
      render(<LanguageSelector value="de" onChange={vi.fn()} variant="full" />);
      expect(screen.getByRole('button', { name: 'portal.language.groupLabel' })).toBeTruthy();
    });

    it('opens dropdown on click', async () => {
      const user = userEvent.setup();
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="full" />);
      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      await user.click(button);
      // Dropdown should open with listbox role
      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('filters languages by search query', async () => {
      const user = userEvent.setup();
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="full" />);
      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      await user.click(button);

      const searchInput = screen.getByPlaceholderText('portal.language.searchPlaceholder');
      await user.type(searchInput, 'de');

      // Should show German but not Japanese (which doesn't contain 'de')
      expect(screen.getByRole('option', { name: /Deutsch/i })).toBeTruthy();
    });
  });

  describe('language selection', () => {
    it('calls onChange when language is selected', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<LanguageSelector value="en" onChange={onChange} variant="full" />);

      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      await user.click(button);

      // Click on German option
      const deOption = screen.getByRole('option', { name: /Deutsch/i });
      await user.click(deOption);

      expect(onChange).toHaveBeenCalledWith('de');
    });

    it('closes dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="full" />);

      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      await user.click(button);
      expect(screen.getByRole('listbox')).toBeTruthy();

      const deOption = screen.getByRole('option', { name: /Deutsch/i });
      await user.click(deOption);

      expect(screen.queryByRole('listbox')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('has proper aria attributes on trigger button', () => {
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="full" />);
      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });
      expect(button.getAttribute('aria-haspopup')).toBe('listbox');
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });

    it('updates aria-expanded when opened', async () => {
      const user = userEvent.setup();
      render(<LanguageSelector value="en" onChange={vi.fn()} variant="full" />);
      const button = screen.getByRole('button', { name: 'portal.language.groupLabel' });

      await user.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
