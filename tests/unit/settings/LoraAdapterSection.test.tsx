/**
 * Tests for components/settings/LoraAdapterSection.tsx
 * QNBS-v3: Mocks SettingsViewContext + loraAdapterService; tests flag-gate, empty state, upload, delete.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockIsEnabled = false;

vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn(() => mockIsEnabled),
}));

vi.mock('../../../contexts/SettingsViewContext', () => ({
  useSettingsViewContext: () => ({
    t: (k: string) => k,
  }),
}));

const mockListAdapters = vi.fn().mockResolvedValue([]);
const mockSaveAdapter = vi.fn().mockResolvedValue(undefined);
const mockDeleteAdapter = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/loraAdapterService', () => ({
  listAdapters: (...args: unknown[]) => mockListAdapters(...args),
  saveAdapter: (...args: unknown[]) => mockSaveAdapter(...args),
  deleteAdapter: (...args: unknown[]) => mockDeleteAdapter(...args),
}));

// QNBS-v3: featureFlagsSlice is NOT mocked — useAppSelector above is mocked to ignore its selector
// argument (returns mockIsEnabled), so the real, typed selectEnableLoraAdapters is harmlessly unused,
// and featureCatalog (loaded via the section's MaturityBadge) keeps its real defaultFeatureFlagsState.

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { LoraAdapterSection } from '../../../components/settings/LoraAdapterSection';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoraAdapterSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled = false;
    mockListAdapters.mockResolvedValue([]);
  });

  it('shows flag-gate message when feature is disabled', () => {
    render(<LoraAdapterSection />);
    expect(screen.getByText('settings.loraAdapters.title')).toBeInTheDocument();
    expect(screen.getByText('settings.loraAdapters.flagGate')).toBeInTheDocument();
  });

  // QNBS-v3: maturity signalling must stay consistent whether the flag is on or off.
  it('shows the Experimental maturity badge even when the feature is disabled', () => {
    render(<LoraAdapterSection />);
    expect(screen.getByText('common.badge.experimental')).toBeInTheDocument();
  });

  it('does not show upload button when feature is disabled', () => {
    render(<LoraAdapterSection />);
    expect(
      screen.queryByRole('button', { name: 'settings.loraAdapters.uploadBtn' }),
    ).not.toBeInTheDocument();
  });

  it('shows title and empty state when feature is enabled', async () => {
    mockIsEnabled = true;
    render(<LoraAdapterSection />);
    expect(screen.getByText('settings.loraAdapters.title')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('settings.loraAdapters.emptyState')).toBeInTheDocument(),
    );
  });

  it('shows upload button when feature is enabled', async () => {
    mockIsEnabled = true;
    render(<LoraAdapterSection />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'settings.loraAdapters.uploadBtn' }),
      ).toBeInTheDocument(),
    );
  });

  it('shows adapter list when adapters are loaded', async () => {
    mockIsEnabled = true;
    mockListAdapters.mockResolvedValue([
      {
        id: 'adapter-1',
        name: 'my-lora',
        fileSizeBytes: 1024 * 1024,
        scale: 1,
        modelCompatibility: '',
        description: '',
        createdAt: Date.now(),
      },
    ]);
    render(<LoraAdapterSection />);
    await waitFor(() => expect(screen.getByText('my-lora')).toBeInTheDocument());
  });

  it('shows formatted file size for adapter', async () => {
    mockIsEnabled = true;
    mockListAdapters.mockResolvedValue([
      {
        id: 'adapter-1',
        name: 'my-lora',
        fileSizeBytes: 2 * 1024 * 1024,
        scale: 0.5,
        modelCompatibility: 'llama',
        description: '',
        createdAt: Date.now(),
      },
    ]);
    render(<LoraAdapterSection />);
    await waitFor(() => expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument());
  });

  it('calls deleteAdapter when delete button is clicked', async () => {
    mockIsEnabled = true;
    mockListAdapters.mockResolvedValue([
      {
        id: 'adapter-1',
        name: 'my-lora',
        fileSizeBytes: 512,
        scale: 1,
        modelCompatibility: '',
        description: '',
        createdAt: Date.now(),
      },
    ]);
    const user = userEvent.setup();
    render(<LoraAdapterSection />);
    await waitFor(() => expect(screen.getByText('my-lora')).toBeInTheDocument());
    const deleteBtn = screen.getByRole('button', { name: /settings.loraAdapters.deleteBtn/ });
    await user.click(deleteBtn);
    await waitFor(() => expect(mockDeleteAdapter).toHaveBeenCalledWith('adapter-1'));
  });

  it('shows model compatibility when present', async () => {
    mockIsEnabled = true;
    mockListAdapters.mockResolvedValue([
      {
        id: 'adapter-1',
        name: 'style-adapter',
        fileSizeBytes: 256,
        scale: 1,
        modelCompatibility: 'mistral',
        description: '',
        createdAt: Date.now(),
      },
    ]);
    render(<LoraAdapterSection />);
    await waitFor(() => expect(screen.getByText(/mistral/)).toBeInTheDocument());
  });
});
