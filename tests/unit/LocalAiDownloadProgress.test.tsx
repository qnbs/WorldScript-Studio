/**
 * Tests for components/settings/LocalAiDownloadProgress.tsx
 * QNBS-v3: Mocks inferenceProgressEmitter + gpuResourceManager; tests progress modal visibility,
 *          progress bar, cancel button, error state.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockSnapshot = {
  state: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  progress: 0,
  estimatedSecondsRemaining: null as number | null,
  text: '',
};
let capturedSubscriber: ((p: typeof mockSnapshot) => void) | null = null;

vi.mock('../../services/ai/inferenceProgressEmitter', () => ({
  inferenceProgressEmitter: {
    getWebLlmLoadingSnapshot: vi.fn(() => mockSnapshot),
    subscribeWebLlmLoading: vi.fn((cb: (p: typeof mockSnapshot) => void) => {
      capturedSubscriber = cb;
      return () => {
        capturedSubscriber = null;
      };
    }),
    reportWebLlmError: vi.fn(),
  },
}));

vi.mock('../../services/ai/gpuResourceManager', () => ({
  gpuResourceManager: {
    releaseGpu: vi.fn(),
  },
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, args?: Record<string, string>) => (args ? `${k}:${JSON.stringify(args)}` : k),
    language: 'en',
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { LocalAiDownloadProgress } from '../../components/settings/LocalAiDownloadProgress';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocalAiDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshot = { state: 'idle', progress: 0, estimatedSecondsRemaining: null, text: '' };
    capturedSubscriber = null;
  });

  it('renders nothing when state is idle', () => {
    const { container } = render(<LocalAiDownloadProgress />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the progress modal when state is loading', () => {
    mockSnapshot = { state: 'loading', progress: 0.5, estimatedSecondsRemaining: 30, text: '' };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders cancel button when loading', () => {
    mockSnapshot = { state: 'loading', progress: 0.3, estimatedSecondsRemaining: null, text: '' };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByText('settings.ai.localAi.cancelButton')).toBeInTheDocument();
  });

  it('shows progress percentage in aria-valuenow', () => {
    mockSnapshot = { state: 'loading', progress: 0.75, estimatedSecondsRemaining: null, text: '' };
    render(<LocalAiDownloadProgress />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '75');
  });

  it('renders error state when state is error', () => {
    mockSnapshot = {
      state: 'error',
      progress: 0,
      estimatedSecondsRemaining: null,
      text: 'Download failed',
    };
    render(<LocalAiDownloadProgress />);
    expect(screen.getByText('Download failed')).toBeInTheDocument();
  });

  it('calls releaseGpu when cancel is clicked', async () => {
    const { gpuResourceManager } = await import('../../services/ai/gpuResourceManager');
    const user = userEvent.setup();
    mockSnapshot = { state: 'loading', progress: 0.2, estimatedSecondsRemaining: null, text: '' };
    render(<LocalAiDownloadProgress />);
    await user.click(screen.getByText('settings.ai.localAi.cancelButton'));
    expect(gpuResourceManager.releaseGpu).toHaveBeenCalledWith('webllm');
  });

  it('updates progress when subscriber fires', async () => {
    mockSnapshot = { state: 'idle', progress: 0, estimatedSecondsRemaining: null, text: '' };
    render(<LocalAiDownloadProgress />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

    // Simulate progress update
    if (capturedSubscriber) {
      capturedSubscriber({
        state: 'loading',
        progress: 0.6,
        estimatedSecondsRemaining: null,
        text: '',
      });
    }
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
  });
});
