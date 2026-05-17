import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted so vi.mock factories can reference them)
// ---------------------------------------------------------------------------

const {
  mockHasGeminiApiKey,
  mockGetGeminiApiKey,
  mockSaveGeminiApiKey,
  mockClearGeminiApiKey,
  mockGenerateText,
  mockInvalidateAiClientCache,
} = vi.hoisted(() => ({
  mockHasGeminiApiKey: vi.fn(),
  mockGetGeminiApiKey: vi.fn(),
  mockSaveGeminiApiKey: vi.fn(),
  mockClearGeminiApiKey: vi.fn(),
  mockGenerateText: vi.fn(),
  mockInvalidateAiClientCache: vi.fn(),
}));

vi.mock('../../services/dbService', () => ({
  dbService: {
    hasGeminiApiKey: mockHasGeminiApiKey,
    getGeminiApiKey: mockGetGeminiApiKey,
    saveGeminiApiKey: mockSaveGeminiApiKey,
    clearGeminiApiKey: mockClearGeminiApiKey,
  },
}));

vi.mock('../../services/geminiService', () => ({
  generateText: mockGenerateText,
  invalidateAiClientCache: mockInvalidateAiClientCache,
}));

vi.mock('../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Minimal UI mocks so we don't pull in the real implementations
vi.mock('../../components/ui/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock('../../components/ui/Button', () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock('../../components/ui/Spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

import type React from 'react';
import ApiKeySection from '../../components/ApiKeySection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApiKeySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasGeminiApiKey.mockResolvedValue(false);
    mockGetGeminiApiKey.mockResolvedValue(null);
    mockSaveGeminiApiKey.mockResolvedValue(undefined);
    mockClearGeminiApiKey.mockResolvedValue(undefined);
  });

  it('renders without throwing', () => {
    expect(() => render(<ApiKeySection />)).not.toThrow();
  });

  it('shows inactive status when no key is configured', async () => {
    render(<ApiKeySection />);
    await waitFor(() => {
      expect(screen.getByText('settings.apiKey.statusInactive')).toBeTruthy();
    });
  });

  it('shows configured status when key exists', async () => {
    mockHasGeminiApiKey.mockResolvedValue(true);
    render(<ApiKeySection />);
    await waitFor(() => {
      expect(screen.getByText('settings.apiKey.statusActive')).toBeTruthy();
    });
  });

  it('shows decryptFailed warning when getGeminiApiKey returns DECRYPT_FAILED', async () => {
    mockHasGeminiApiKey.mockResolvedValue(false);
    mockGetGeminiApiKey.mockResolvedValue('DECRYPT_FAILED');
    render(<ApiKeySection />);
    await waitFor(() => {
      expect(screen.getByText('apiKey.decryptFailed')).toBeTruthy();
    });
  });

  it('shows error when saving empty key', async () => {
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('settings.apiKey.statusInactive'));

    // find save button (disabled when input empty, but we can still test the error message path)
    const input = screen.getByPlaceholderText('AIza...');
    // type an invalid prefix (not AIza)
    fireEvent.change(input, { target: { value: 'bad-key' } });

    const saveBtn = screen.getByText('settings.apiKey.save');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(screen.getByText('settings.apiKey.errorInvalid')).toBeTruthy();
    });
  });

  it('saves a valid key and shows success', async () => {
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('settings.apiKey.statusInactive'));

    const input = screen.getByPlaceholderText('AIza...');
    fireEvent.change(input, { target: { value: 'AIzaValidKey123' } });

    const saveBtn = screen.getByText('settings.apiKey.save');
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(mockSaveGeminiApiKey).toHaveBeenCalledWith('AIzaValidKey123');
      expect(mockInvalidateAiClientCache).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('settings.apiKey.saved')).toBeTruthy();
    });
  });

  it('shows save error when dbService throws', async () => {
    mockSaveGeminiApiKey.mockRejectedValue(new Error('DB error'));
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('settings.apiKey.statusInactive'));

    const input = screen.getByPlaceholderText('AIza...');
    fireEvent.change(input, { target: { value: 'AIzaValidKey123' } });
    fireEvent.click(screen.getByText('settings.apiKey.save'));
    await waitFor(() => {
      expect(screen.getByText('DB error')).toBeTruthy();
    });
  });

  it('removes key and shows removed message', async () => {
    mockHasGeminiApiKey.mockResolvedValue(true);
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('settings.apiKey.statusActive'));

    const removeBtn = screen.getByText('settings.apiKey.remove');
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(mockClearGeminiApiKey).toHaveBeenCalled();
      expect(mockInvalidateAiClientCache).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('settings.apiKey.removed')).toBeTruthy();
    });
  });

  it('shows test connection result on success', async () => {
    mockHasGeminiApiKey.mockResolvedValue(true);
    mockGenerateText.mockResolvedValue('OK');
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('apiKey.test'));

    fireEvent.click(screen.getByText('apiKey.test'));
    await waitFor(() => {
      expect(screen.getByText('apiKey.connectionSuccess')).toBeTruthy();
    });
  });

  it('shows invalid key message when test returns INVALID_API_KEY error', async () => {
    mockHasGeminiApiKey.mockResolvedValue(true);
    mockGenerateText.mockRejectedValue(new Error('INVALID_API_KEY error'));
    render(<ApiKeySection />);
    await waitFor(() => screen.getByText('apiKey.test'));

    fireEvent.click(screen.getByText('apiKey.test'));
    await waitFor(() => {
      expect(screen.getByText('apiKey.invalidKey')).toBeTruthy();
    });
  });

  it('toggles key visibility when show/hide button is clicked', async () => {
    render(<ApiKeySection />);
    await waitFor(() => screen.getByPlaceholderText('AIza...'));

    const input = screen.getByPlaceholderText('AIza...') as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggleBtn = screen.getByLabelText('settings.apiKey.show');
    fireEvent.click(toggleBtn);
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByLabelText('settings.apiKey.hide'));
    expect(input.type).toBe('password');
  });
});
