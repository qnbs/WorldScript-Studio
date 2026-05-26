/**
 * Tests for components/ui/Progress.tsx
 * QNBS-v3: Pure rendering — tests clamping (0–100), width style, className passthrough.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Progress } from '../../../components/ui/Progress';

describe('Progress', () => {
  it('renders a bar div', () => {
    const { container } = render(<Progress value={50} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar).not.toBeNull();
  });

  it('sets width to value%', () => {
    const { container } = render(<Progress value={75} />);
    // QNBS-v3: querySelector('[style]') targets the inner bar div which carries the inline width
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('75%');
  });

  it('clamps value below 0 to 0%', () => {
    const { container } = render(<Progress value={-10} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });

  it('clamps value above 100 to 100%', () => {
    const { container } = render(<Progress value={150} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('renders correctly at exactly 0', () => {
    const { container } = render(<Progress value={0} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });

  it('renders correctly at exactly 100', () => {
    const { container } = render(<Progress value={100} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('applies className to outer div', () => {
    const { container } = render(<Progress value={50} className="my-custom-class" />);
    const outer = container.querySelector('div') as HTMLElement;
    expect(outer.className).toContain('my-custom-class');
  });
});
