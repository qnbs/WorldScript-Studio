/**
 * Tests for VoiceModelDownloadModal.tsx — Progress UI for WASM voice model downloads.
 * QNBS-v3: P1 tests for P0-5 voice WASM download UI.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceModelDownloadModal } from '../../../../components/voice/VoiceModelDownloadModal';

// Mock hooks and dependencies
vi.mock('../../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'voice.modelDownload.title': 'Voice Model Download',
        'voice.modelDownload.description': 'Downloading {{model}} model ({{size}} MB)',
        'voice.modelDownload.progress': '{{percent}}% complete',
        // QNBS-v3 (#333 item 1):
        'voice.modelDownload.progressBytes': '{{loaded}} MB of {{total}} MB',
        'voice.modelDownload.speed': '{{speed}} MB/s',
        'voice.modelDownload.error': 'Download failed: {{error}}',
        'voice.modelDownload.cancel': 'Cancel',
        'voice.modelDownload.retry': 'Retry',
      };
      const template = translations[key] || key;
      if (opts) {
        return Object.entries(opts).reduce(
          (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
          template,
        );
      }
      return template;
    },
    // QNBS-v3 (#333/Sourcery): mirrors formatNumber's real 1-decimal rendering for the speed display.
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      value.toFixed(options?.maximumFractionDigits ?? 0),
  }),
}));

// QNBS-v3 (#333 item 1): mutable per-test state, selector-aware (not the prior `() => 0` stub) so
// tests can control progress/loadedBytes/totalBytes independently.
const mockVoiceState = vi.hoisted(() => ({
  wasmModelDownloadProgress: 0,
  wasmModelDownloadLoadedBytes: undefined as number | undefined,
  wasmModelDownloadTotalBytes: undefined as number | undefined,
}));

vi.mock('../../../../app/hooks', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ settings: { voice: mockVoiceState } }),
}));

// QNBS-v3 (#333 item 1): never resolves — keeps isDownloading true so the loading-state JSX
// (progress bar + size/speed text) can be asserted without racing the real download flow, which
// is already covered directly in tests/unit/services/voice/voiceCommandService.test.ts.
vi.mock('../../../../services/voice/voiceCommandService', () => ({
  downloadVoiceModels: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../../../features/settings/settingsSlice', () => ({
  settingsActions: {
    setVoiceSettings: vi.fn(),
  },
}));

vi.mock('../../../../components/ui/Modal', () => ({
  Modal: ({
    children,
    isOpen,
    onClose,
    title,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    title?: string;
  }) =>
    isOpen ? (
      <div data-testid="modal" role="dialog" aria-label={title}>
        {children}
        <button type="button" onClick={onClose} data-testid="close-btn">
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('../../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid="button"
      data-variant={variant}
    >
      {children}
    </button>
  ),
}));

vi.mock('../../../../components/ui/Progress', () => ({
  Progress: ({ value }: { value: number }) => <div data-testid="progress" data-value={value} />,
}));

describe('VoiceModelDownloadModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    modelType: 'stt' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceState.wasmModelDownloadProgress = 0;
    mockVoiceState.wasmModelDownloadLoadedBytes = undefined;
    mockVoiceState.wasmModelDownloadTotalBytes = undefined;
  });

  it('renders with correct title', () => {
    render(<VoiceModelDownloadModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Voice Model Download');
  });

  it('shows model description with correct size for STT (Whisper)', () => {
    render(<VoiceModelDownloadModal {...defaultProps} modelType="stt" />);
    expect(screen.getByText(/Downloading.*Whisper.*42 MB/)).toBeInTheDocument();
  });

  it('shows model description with correct size for TTS (Kokoro)', () => {
    render(<VoiceModelDownloadModal {...defaultProps} modelType="tts" />);
    expect(screen.getByText(/Downloading.*Kokoro.*15 MB/)).toBeInTheDocument();
  });

  it('renders cancel button', () => {
    render(<VoiceModelDownloadModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<VoiceModelDownloadModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<VoiceModelDownloadModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('renders cancel button with correct label', () => {
    render(<VoiceModelDownloadModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders model description with correct model name', () => {
    render(<VoiceModelDownloadModal {...defaultProps} modelType="stt" />);
    expect(screen.getByText(/Whisper/)).toBeInTheDocument();
  });

  it('renders model description for TTS model type', () => {
    render(<VoiceModelDownloadModal {...defaultProps} modelType="tts" />);
    expect(screen.getByText(/Kokoro/)).toBeInTheDocument();
  });

  // QNBS-v3 (#333 item 1)
  describe('byte-level progress display', () => {
    it('shows loaded/total MB once both are known', async () => {
      mockVoiceState.wasmModelDownloadLoadedBytes = 21_000_000;
      mockVoiceState.wasmModelDownloadTotalBytes = 42_000_000;
      render(<VoiceModelDownloadModal {...defaultProps} />);
      await waitFor(() => expect(screen.getByTestId('progress')).toBeInTheDocument());
      expect(screen.getByText('20 MB of 40 MB')).toBeInTheDocument();
    });

    it('shows no size text when byte counts are not yet known', async () => {
      render(<VoiceModelDownloadModal {...defaultProps} />);
      await waitFor(() => expect(screen.getByTestId('progress')).toBeInTheDocument());
      expect(screen.queryByText(/MB of/)).not.toBeInTheDocument();
    });

    // QNBS-v3 (#333/Sourcery): exercises the delta-based bytesPerSecond effect end-to-end. Uses fake
    // timers directly (not waitFor's own polling, which deadlocks once Date.now/setTimeout are faked)
    // — render/rerender are act()-wrapped by RTL, so state settles synchronously after each call. The
    // component is React.memo-wrapped, so the second render passes a fresh onClose reference — a
    // shallow-equal props object would make memo bail out and never re-read the mutated selector value.
    it('shows a MB/s speed label once two byte samples have elapsed', () => {
      vi.useFakeTimers();
      try {
        mockVoiceState.wasmModelDownloadLoadedBytes = 10 * 1024 * 1024;
        mockVoiceState.wasmModelDownloadTotalBytes = 42 * 1024 * 1024;
        const { rerender } = render(<VoiceModelDownloadModal {...defaultProps} />);
        expect(screen.getByTestId('progress')).toBeInTheDocument();
        expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(1000);
        });
        mockVoiceState.wasmModelDownloadLoadedBytes = 13.2 * 1024 * 1024;
        rerender(<VoiceModelDownloadModal {...defaultProps} onClose={vi.fn()} />);

        expect(screen.getByText('3.2 MB/s')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
