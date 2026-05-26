/**
 * Tests for components/character-interviews/ArchetypeSelector.tsx
 * QNBS-v3: Tests render, archetype selection, keyboard activation.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectArchetype = vi.fn();
let mockSelectedArchetype = '';

vi.mock('../../contexts/CharacterInterviewsViewContext', () => ({
  useCharacterInterviewsViewContext: () => ({
    selectedArchetype: mockSelectedArchetype,
    selectArchetype: mockSelectArchetype,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, language: 'en' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ArchetypeSelector } from '../../components/character-interviews/ArchetypeSelector';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ArchetypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedArchetype = '';
  });

  it('renders a listbox', () => {
    render(<ArchetypeSelector />);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('renders all archetype options', () => {
    render(<ArchetypeSelector />);
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(5);
  });

  it('shows archetypeDescription text', () => {
    render(<ArchetypeSelector />);
    expect(screen.getByText('characterInterviews.archetypeDescription')).toBeInTheDocument();
  });

  it('calls selectArchetype when an option is clicked', async () => {
    const user = userEvent.setup();
    render(<ArchetypeSelector />);
    const options = screen.getAllByRole('option');
    await user.click(options[0]);
    expect(mockSelectArchetype).toHaveBeenCalledTimes(1);
  });

  it('selected option has aria-selected=true', () => {
    mockSelectedArchetype = 'hero';
    render(<ArchetypeSelector />);
    const heroOption = screen.getByRole('option', { name: /hero/i, selected: true });
    expect(heroOption.getAttribute('aria-selected')).toBe('true');
  });

  it('non-selected options have aria-selected=false', () => {
    mockSelectedArchetype = 'hero';
    render(<ArchetypeSelector />);
    const options = screen.getAllByRole('option');
    const nonSelected = options.filter((o) => o.getAttribute('aria-selected') === 'false');
    expect(nonSelected.length).toBeGreaterThan(0);
  });

  it('calls selectArchetype on Enter key press', async () => {
    const user = userEvent.setup();
    render(<ArchetypeSelector />);
    const options = screen.getAllByRole('option');
    options[0].focus();
    await user.keyboard('{Enter}');
    expect(mockSelectArchetype).toHaveBeenCalledTimes(1);
  });

  it('calls selectArchetype on Space key press', async () => {
    const user = userEvent.setup();
    render(<ArchetypeSelector />);
    const options = screen.getAllByRole('option');
    options[0].focus();
    await user.keyboard(' ');
    expect(mockSelectArchetype).toHaveBeenCalledTimes(1);
  });
});
