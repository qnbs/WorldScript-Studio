import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveStatusIndicator } from '../../components/ui/SaveStatusIndicator';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockSavingStatus: 'idle' | 'saving' | 'saved' = 'idle';

vi.mock('../../app/hooks', () => ({
  useAppSelector: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ status: { saving: mockSavingStatus } }),
  ),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('../../components/ui/Spinner', () => ({
  Spinner: ({ className }: { className?: string }) => (
    <div data-testid="spinner" className={className} />
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSavingStatus = 'idle';
});

describe('SaveStatusIndicator', () => {
  it('renders nothing when saving status is idle', () => {
    mockSavingStatus = 'idle';
    const { container } = render(<SaveStatusIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('shows spinner and saving text when status is saving', () => {
    mockSavingStatus = 'saving';
    render(<SaveStatusIndicator />);
    expect(screen.getByTestId('spinner')).toBeTruthy();
    expect(screen.getByText('common.saving')).toBeTruthy();
  });

  it('shows saved text when status is saved', () => {
    mockSavingStatus = 'saved';
    render(<SaveStatusIndicator />);
    expect(screen.getByText('common.saved')).toBeTruthy();
    expect(screen.queryByTestId('spinner')).toBeNull();
  });
});
