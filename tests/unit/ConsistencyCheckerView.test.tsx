import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConsistencyCheckerView } from '../../components/ConsistencyCheckerView';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunCheck = vi.fn();
const mockSetSelectedCharacterId = vi.fn();

vi.mock('../../hooks/useConsistencyCheckerView', () => ({
  useConsistencyCheckerView: vi.fn(() => ({
    t: (k: string) => k,
    characters: [
      { id: 'c1', name: 'Alice' },
      { id: 'c2', name: 'Bob' },
    ],
    selectedCharacterId: 'c1',
    setSelectedCharacterId: mockSetSelectedCharacterId,
    checkResult: null,
    isChecking: false,
    runCheck: mockRunCheck,
    storyCodex: null,
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsistencyCheckerView', () => {
  it('renders without throwing', () => {
    expect(() => render(<ConsistencyCheckerView />)).not.toThrow();
  });

  it('shows the title', () => {
    render(<ConsistencyCheckerView />);
    expect(screen.getByText('consistencyChecker.title')).toBeTruthy();
  });

  it('renders character options in the select', () => {
    render(<ConsistencyCheckerView />);
    expect(screen.getByRole('option', { name: 'Alice' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bob' })).toBeTruthy();
  });

  it('shows the check button', () => {
    render(<ConsistencyCheckerView />);
    expect(screen.getByRole('button', { name: 'consistencyChecker.checkButton' })).toBeTruthy();
  });

  it('calls runCheck when button is clicked', () => {
    render(<ConsistencyCheckerView />);
    fireEvent.click(screen.getByRole('button', { name: 'consistencyChecker.checkButton' }));
    expect(mockRunCheck).toHaveBeenCalledWith('c1');
  });

  it('shows no results when checkResult is null', () => {
    render(<ConsistencyCheckerView />);
    expect(screen.getByText('consistencyChecker.noResults')).toBeTruthy();
  });

  it('shows check result when provided', async () => {
    const { useConsistencyCheckerView } = await import('../../hooks/useConsistencyCheckerView');
    vi.mocked(useConsistencyCheckerView).mockReturnValueOnce({
      t: (k: string) => k,
      characters: [],
      selectedCharacterId: null,
      setSelectedCharacterId: mockSetSelectedCharacterId,
      checkResult: 'Inconsistency found: Alice has blue eyes in Ch1 but brown in Ch3.',
      isChecking: false,
      runCheck: mockRunCheck,
      storyCodex: null,
    } as never);
    render(<ConsistencyCheckerView />);
    expect(screen.getByText(/Inconsistency found/)).toBeTruthy();
  });
});
