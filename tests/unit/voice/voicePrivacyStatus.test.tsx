/**
 * @vitest-environment jsdom
 * QNBS-v3: SEC-4 — VoicePrivacyStatus renders correct badge based on active STT engine.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock Redux hooks before importing the component
vi.mock('../../../app/hooks', () => ({
  useAppSelector: vi.fn(),
  useAppDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key.split('.').pop() ?? key,
  }),
}));

import { useAppSelector } from '../../../app/hooks';
import VoicePrivacyStatus from '../../../components/voice/VoicePrivacyStatus';

describe('VoicePrivacyStatus', () => {
  it('shows External badge when Web Speech API is the active STT engine', () => {
    // QNBS-v3: selectVoiceSettings returns VoiceSettings directly, not wrapped in { voice }
    vi.mocked(useAppSelector).mockReturnValue({ sttEngine: 'webSpeech' });
    render(<VoicePrivacyStatus />);
    expect(screen.getByText('statusExternal')).toBeInTheDocument();
  });

  it('shows Local badge when a local STT engine is active', () => {
    vi.mocked(useAppSelector).mockReturnValue({ sttEngine: 'auto' });
    render(<VoicePrivacyStatus />);
    expect(screen.getByText('statusLocal')).toBeInTheDocument();
  });
});
