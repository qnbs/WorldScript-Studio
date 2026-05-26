/**
 * Tests for hooks/useVoiceAccessibility.ts
 * QNBS-v3: Mocks audioNavigator + useVoice; covers announcement side effects and landmark nav.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockAnnounce, mockNextLandmark, mockPreviousLandmark, mockScanLandmarks } = vi.hoisted(
  () => ({
    mockAnnounce: vi.fn(),
    mockNextLandmark: vi.fn().mockReturnValue(null),
    mockPreviousLandmark: vi.fn().mockReturnValue(null),
    mockScanLandmarks: vi.fn(),
  }),
);

vi.mock('../../../services/voice/audioNavigator', () => ({
  audioNavigator: {
    announce: mockAnnounce,
    nextLandmark: mockNextLandmark,
    previousLandmark: mockPreviousLandmark,
    scanLandmarks: mockScanLandmarks,
  },
}));

let mockMode = 'inactive';
let mockTranscript = '';
let mockError: string | null = null;
let mockEnabled = true;

vi.mock('../../../hooks/useVoice', () => ({
  useVoice: () => ({
    mode: mockMode,
    transcript: mockTranscript,
    error: mockError,
    enabled: mockEnabled,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useVoiceAccessibility } from '../../../hooks/useVoiceAccessibility';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoiceAccessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMode = 'inactive';
    mockTranscript = '';
    mockError = null;
    mockEnabled = true;
    mockNextLandmark.mockReturnValue(null);
    mockPreviousLandmark.mockReturnValue(null);
  });

  describe('mode announcement side effect', () => {
    it('announces "Voice listening active" when mode is "listening"', () => {
      mockMode = 'listening';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith('Voice listening active. Speak now.', 'polite');
    });

    it('announces "Processing voice command" when mode is "processing"', () => {
      mockMode = 'processing';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith('Processing voice command...', 'polite');
    });

    it('announces "Speaking feedback" when mode is "speaking"', () => {
      mockMode = 'speaking';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith('Speaking feedback...', 'polite');
    });

    it('announces dictation mode when mode is "dictating"', () => {
      mockMode = 'dictating';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith(
        'Dictation active. Speak to insert text.',
        'polite',
      );
    });

    it('does not announce when mode is "inactive"', () => {
      mockMode = 'inactive';
      renderHook(() => useVoiceAccessibility());
      // Only the error/transcript effects may fire — mode=inactive should not announce
      const modeCalls = mockAnnounce.mock.calls.filter(
        ([msg]) =>
          typeof msg === 'string' && (msg.includes('listening') || msg.includes('Processing')),
      );
      expect(modeCalls).toHaveLength(0);
    });

    it('does not announce when voice is disabled', () => {
      mockEnabled = false;
      mockMode = 'listening';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).not.toHaveBeenCalled();
    });
  });

  describe('error announcement', () => {
    it('announces error assertively when error is set and enabled', () => {
      mockError = 'Microphone permission denied';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith(
        'Voice error: Microphone permission denied',
        'assertive',
      );
    });

    it('does not announce error when disabled', () => {
      mockEnabled = false;
      mockError = 'some error';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).not.toHaveBeenCalled();
    });
  });

  describe('transcript announcement', () => {
    it('announces transcript when mode is processing', () => {
      mockMode = 'processing';
      mockTranscript = 'go to chapter two';
      renderHook(() => useVoiceAccessibility());
      expect(mockAnnounce).toHaveBeenCalledWith('Heard: go to chapter two', 'polite');
    });

    it('does not announce transcript when mode is not processing', () => {
      mockMode = 'listening';
      mockTranscript = 'some text';
      renderHook(() => useVoiceAccessibility());
      const transcriptCalls = mockAnnounce.mock.calls.filter(([msg]) =>
        String(msg).startsWith('Heard:'),
      );
      expect(transcriptCalls).toHaveLength(0);
    });
  });

  describe('focusNextLandmark', () => {
    it('calls audioNavigator.nextLandmark and announces result when label exists', () => {
      mockNextLandmark.mockReturnValue('Main navigation');
      const { result } = renderHook(() => useVoiceAccessibility());
      const label = result.current.focusNextLandmark();
      expect(label).toBe('Main navigation');
      expect(mockAnnounce).toHaveBeenCalledWith('Main navigation', 'polite');
    });

    it('returns null when no next landmark', () => {
      mockNextLandmark.mockReturnValue(null);
      const { result } = renderHook(() => useVoiceAccessibility());
      const label = result.current.focusNextLandmark();
      expect(label).toBeNull();
    });
  });

  describe('focusPreviousLandmark', () => {
    it('calls audioNavigator.previousLandmark and announces result', () => {
      mockPreviousLandmark.mockReturnValue('Sidebar');
      const { result } = renderHook(() => useVoiceAccessibility());
      const label = result.current.focusPreviousLandmark();
      expect(label).toBe('Sidebar');
      expect(mockAnnounce).toHaveBeenCalledWith('Sidebar', 'polite');
    });
  });

  describe('announce', () => {
    it('delegates to audioNavigator.announce with given priority', () => {
      const { result } = renderHook(() => useVoiceAccessibility());
      result.current.announce('Chapter saved', 'assertive');
      expect(mockAnnounce).toHaveBeenCalledWith('Chapter saved', 'assertive');
    });

    it('defaults to polite priority', () => {
      const { result } = renderHook(() => useVoiceAccessibility());
      result.current.announce('Draft updated');
      expect(mockAnnounce).toHaveBeenCalledWith('Draft updated', 'polite');
    });
  });
});
