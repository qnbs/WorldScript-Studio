import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceLevelMeter } from '../../components/voice/VoiceLevelMeter';

describe('VoiceLevelMeter', () => {
  it('renders a 5-bar meter', () => {
    render(<VoiceLevelMeter level={0} />);
    const meter = screen.getByTestId('voice-level-meter');
    expect(meter.children).toHaveLength(5);
  });

  it('fills bars proportionally to the level', () => {
    const { rerender } = render(<VoiceLevelMeter level={0.6} />);
    const accentBars = () =>
      Array.from(screen.getByTestId('voice-level-meter').children).filter((c) =>
        c.className.includes('--sc-accent'),
      ).length;
    expect(accentBars()).toBe(3); // round(0.6 * 5)
    rerender(<VoiceLevelMeter level={1} />);
    expect(accentBars()).toBe(5);
    rerender(<VoiceLevelMeter level={0} />);
    expect(accentBars()).toBe(0);
  });

  it('clamps out-of-range levels', () => {
    render(<VoiceLevelMeter level={5} />);
    const accent = Array.from(screen.getByTestId('voice-level-meter').children).filter((c) =>
      c.className.includes('--sc-accent'),
    ).length;
    expect(accent).toBe(5);
  });
});
