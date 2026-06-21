/**
 * Tests for the reusable Badge atom (Experimental / Beta / New labelling).
 * QNBS-v3: pure rendering — no Redux/context deps.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('renders the default text for each variant', () => {
    const { rerender } = render(<Badge variant="experimental" />);
    expect(screen.getByText('Experimental')).toBeInTheDocument();
    rerender(<Badge variant="beta" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    rerender(<Badge variant="new" />);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders custom children over the default text', () => {
    render(<Badge variant="beta">Preview</Badge>);
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('applies the variant token classes (theme-safe, no hardcoded colors)', () => {
    const { container } = render(<Badge variant="experimental" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('var(--sc-warning-fg)');
    expect(el.className).toContain('var(--sc-warning-bg)');
    expect(el.className).not.toMatch(/text-(amber|yellow|green|blue)-\d/);
  });

  it('exposes an accessible label when srLabel is provided', () => {
    render(<Badge variant="beta" srLabel="Beta feature" />);
    const note = screen.getByRole('note', { name: 'Beta feature' });
    expect(note).toBeInTheDocument();
  });

  it('hides itself from the a11y tree when srLabel is an empty string (decorative)', () => {
    const { container } = render(<Badge variant="experimental" srLabel="" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('applies a custom className', () => {
    const { container } = render(<Badge variant="new" className="ml-2" />);
    expect((container.firstChild as HTMLElement).className).toContain('ml-2');
  });
});
