/**
 * Tests for hooks/usePushToTalk.ts
 * QNBS-v3: Covers Ctrl+Shift+V key combo activation, release, guard conditions.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockVoiceSettings = {
  enabled: true,
  activationMode: 'pushToTalk' as string,
};
let mockVoiceMode = 'inactive';

vi.mock('../../../app/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      settings: { voice: mockVoiceSettings },
      voice: { mode: mockVoiceMode },
    }),
}));

vi.mock('../../../features/settings/settingsSlice', () => ({
  selectVoiceSettings: (s: { settings: { voice: typeof mockVoiceSettings } }) => s.settings.voice,
}));

vi.mock('../../../features/voice/voiceSlice', () => ({
  selectVoiceMode: (s: { voice: { mode: string } }) => s.voice.mode,
}));

const mockStartListening = vi.fn().mockResolvedValue(undefined);
const mockStopListening = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../services/voice/voiceCommandService', () => ({
  getVoiceService: () => ({
    startListening: mockStartListening,
    stopListening: mockStopListening,
  }),
}));

vi.mock('../../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { usePushToTalk } from '../../../hooks/usePushToTalk';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function fireKeyDown(key: string, ctrl = true, shift = true) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, ctrlKey: ctrl, shiftKey: shift, bubbles: true }),
  );
}

function fireKeyUp(key: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

describe('usePushToTalk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVoiceSettings = { enabled: true, activationMode: 'pushToTalk' };
    mockVoiceMode = 'inactive';
  });

  it('does not attach listeners when voice is disabled', () => {
    mockVoiceSettings = { enabled: false, activationMode: 'pushToTalk' };
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    expect(mockStartListening).not.toHaveBeenCalled();
  });

  it('does not attach listeners when activationMode is not pushToTalk', () => {
    mockVoiceSettings = { enabled: true, activationMode: 'manual' };
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    expect(mockStartListening).not.toHaveBeenCalled();
  });

  it('calls startListening on Ctrl+Shift+V keydown', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    expect(mockStartListening).toHaveBeenCalledTimes(1);
  });

  it('does not call startListening without Ctrl', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v', false, true);
    expect(mockStartListening).not.toHaveBeenCalled();
  });

  it('does not call startListening without Shift', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v', true, false);
    expect(mockStartListening).not.toHaveBeenCalled();
  });

  it('calls stopListening on Control key up after PTT start', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    fireKeyUp('Control');
    expect(mockStopListening).toHaveBeenCalled();
  });

  it('calls stopListening on Shift key up after PTT start', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    fireKeyUp('Shift');
    expect(mockStopListening).toHaveBeenCalled();
  });

  it('calls stopListening on v key up after PTT start', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    fireKeyUp('v');
    expect(mockStopListening).toHaveBeenCalled();
  });

  it('does not call startListening twice if already listening', () => {
    renderHook(() => usePushToTalk());
    fireKeyDown('v');
    fireKeyDown('v'); // second keydown while still pressed
    expect(mockStartListening).toHaveBeenCalledTimes(1);
  });

  it('removes event listeners on unmount', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => usePushToTalk());
    unmount();
    expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(spy).toHaveBeenCalledWith('keyup', expect.any(Function));
  });
});
