/**
 * Tests for hooks/useVoiceDictation.ts
 * QNBS-v3: Covers transcript append logic, separator insertion, dictation guard.
 * Pattern: start inactive/empty so lastTranscriptRef initialises to '' via the
 * inactive branch, then rerender with dictation + transcript to trigger append.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockDictationActive = false;
let mockTranscript = '';

vi.mock('../../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      voice: {
        dictationActive: mockDictationActive,
        transcript: mockTranscript,
      },
    }),
}));

vi.mock('../../../features/voice/voiceSlice', () => ({
  selectDictationActive: (s: { voice: { dictationActive: boolean } }) => s.voice.dictationActive,
  selectVoiceTranscript: (s: { voice: { transcript: string } }) => s.voice.transcript,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useVoiceDictation } from '../../../hooks/useVoiceDictation';

// ---------------------------------------------------------------------------
// Helper: renders hook in inactive/empty state so lastTranscriptRef === ''.
// ---------------------------------------------------------------------------
function renderInactive(getContent: () => string, setContent: (c: string) => void) {
  mockDictationActive = false;
  mockTranscript = '';
  return renderHook(() => useVoiceDictation(getContent, setContent));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVoiceDictation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDictationActive = false;
    mockTranscript = '';
  });

  it('does not call setContent when dictation is inactive', () => {
    const getContent = vi.fn().mockReturnValue('existing text');
    const setContent = vi.fn();
    mockDictationActive = false;
    mockTranscript = 'hello';
    renderHook(() => useVoiceDictation(getContent, setContent));
    expect(setContent).not.toHaveBeenCalled();
  });

  it('does not call setContent when transcript is empty', () => {
    const getContent = vi.fn().mockReturnValue('some text');
    const setContent = vi.fn();
    // QNBS-v3: lastTranscriptRef starts at '' (inactive clears it), current='' → no append
    mockDictationActive = true;
    mockTranscript = '';
    renderHook(() => useVoiceDictation(getContent, setContent));
    expect(setContent).not.toHaveBeenCalled();
  });

  it('appends new transcript portion to existing content', () => {
    const getContent = vi.fn().mockReturnValue('Hello');
    const setContent = vi.fn();
    // QNBS-v3: inactive first → lastRef=''; then activate with transcript → append
    const { rerender } = renderInactive(getContent, setContent);
    mockDictationActive = true;
    mockTranscript = 'world';
    rerender();
    expect(setContent).toHaveBeenCalledWith('Hello world');
  });

  it('does not add separator when content ends with space', () => {
    const getContent = vi.fn().mockReturnValue('Hello ');
    const setContent = vi.fn();
    const { rerender } = renderInactive(getContent, setContent);
    mockDictationActive = true;
    mockTranscript = 'world';
    rerender();
    expect(setContent).toHaveBeenCalledWith('Hello world');
  });

  it('does not add separator when content ends with newline', () => {
    const getContent = vi.fn().mockReturnValue('Line 1\n');
    const setContent = vi.fn();
    const { rerender } = renderInactive(getContent, setContent);
    mockDictationActive = true;
    mockTranscript = 'Line 2';
    rerender();
    expect(setContent).toHaveBeenCalledWith('Line 1\nLine 2');
  });

  it('works with empty existing content', () => {
    const getContent = vi.fn().mockReturnValue('');
    const setContent = vi.fn();
    const { rerender } = renderInactive(getContent, setContent);
    mockDictationActive = true;
    mockTranscript = 'start';
    rerender();
    expect(setContent).toHaveBeenCalledWith('start');
  });

  it('only appends the NEW portion when transcript grows incrementally', () => {
    const getContent = vi.fn().mockReturnValue('Text');
    const setContent = vi.fn();
    // QNBS-v3: simulate incremental STT — each rerender adds to the transcript
    const { rerender } = renderInactive(getContent, setContent);

    // First chunk: transcript grows to 'hello'
    mockDictationActive = true;
    mockTranscript = 'hello';
    rerender();
    expect(setContent).toHaveBeenCalledWith('Text hello');

    // Second chunk: transcript grows to 'helloworld' (slice adds 'world', separator adds ' ')
    getContent.mockReturnValue('Text hello');
    mockTranscript = 'helloworld';
    rerender();
    expect(setContent).toHaveBeenCalledWith('Text hello world');
  });
});
