/**
 * Tests for the reusable Badge atom (Experimental / Beta / New labelling).
 * QNBS-v3: pure rendering — no Redux/context deps.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '../../components/ui/Badge';

describe('Badge', () => {
  it('renders the caller-supplied (translated) label for each variant', () => {
    const { rerender } = render(<Badge variant="experimental">Experimental</Badge>);
    expect(screen.getByText('Experimental')).toBeInTheDocument();
    rerender(<Badge variant="beta">Beta</Badge>);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    rerender(<Badge variant="new">New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders arbitrary children (caller owns the copy — no hardcoded strings in the atom)', () => {
    render(<Badge variant="beta">Preview</Badge>);
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('applies the variant token classes (theme-safe, no hardcoded colors)', () => {
    const { container } = render(<Badge variant="experimental">Experimental</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('var(--sc-warning-fg)');
    expect(el.className).toContain('var(--sc-warning-bg)');
    expect(el.className).not.toMatch(/text-(amber|yellow|green|blue)-\d/);
  });

  it('exposes an accessible label when srLabel is provided', () => {
    render(
      <Badge variant="beta" srLabel="Beta feature">
        Beta
      </Badge>,
    );
    const note = screen.getByRole('note', { name: 'Beta feature' });
    expect(note).toBeInTheDocument();
  });

  it('hides itself from the a11y tree when srLabel is an empty string (decorative)', () => {
    const { container } = render(
      <Badge variant="experimental" srLabel="">
        Experimental
      </Badge>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('applies a custom className', () => {
    const { container } = render(
      <Badge variant="new" className="ml-2">
        New
      </Badge>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('ml-2');
  });
});
