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

vi.mock('../../components/ui/Select', () => ({
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

  it('renders structured findings with severity badges', async () => {
    const { useConsistencyCheckerView } = await import('../../hooks/useConsistencyCheckerView');
    vi.mocked(useConsistencyCheckerView).mockReturnValueOnce({
      t: (k: string) => k,
      characters: [],
      selectedCharacterId: null,
      setSelectedCharacterId: mockSetSelectedCharacterId,
      checkResult: {
        kind: 'structured',
        findings: [
          {
            id: '0',
            severity: 'error',
            title: 'Eye colour',
            detail: 'Alice has blue eyes in Ch1 but brown in Ch3.',
            ref: 'Chapter 3',
          },
        ],
      },
      isChecking: false,
      runCheck: mockRunCheck,
      storyCodex: null,
    } as never);
    render(<ConsistencyCheckerView />);
    expect(screen.getByText('Eye colour')).toBeTruthy();
    expect(screen.getByText(/Alice has blue eyes/)).toBeTruthy();
    expect(screen.getByText('consistencyChecker.severity.error')).toBeTruthy();
  });

  it('falls back to a raw text block when the result is unstructured', async () => {
    const { useConsistencyCheckerView } = await import('../../hooks/useConsistencyCheckerView');
    vi.mocked(useConsistencyCheckerView).mockReturnValueOnce({
      t: (k: string) => k,
      characters: [],
      selectedCharacterId: null,
      setSelectedCharacterId: mockSetSelectedCharacterId,
      checkResult: { kind: 'text', text: 'Error: Service unavailable' },
      isChecking: false,
      runCheck: mockRunCheck,
      storyCodex: null,
    } as never);
    render(<ConsistencyCheckerView />);
    expect(screen.getByText(/Service unavailable/)).toBeTruthy();
  });
});
