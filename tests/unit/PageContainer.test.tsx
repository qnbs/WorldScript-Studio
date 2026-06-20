/**
 * Tests for components/ui/PageContainer.tsx
 * QNBS-v3: Pure wrapper; the desktop width cap is CSS-only (.is-desktop .view-shell in index.css),
 * so these tests assert the markup contract — `.view-shell`, children, merged className.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageContainer } from '../../components/ui/PageContainer';

describe('PageContainer', () => {
  it('renders its children', () => {
    render(
      <PageContainer>
        <p>inner content</p>
      </PageContainer>,
    );
    expect(screen.getByText('inner content')).toBeInTheDocument();
  });

  it('applies the view-shell width primitive class', () => {
    const { container } = render(
      <PageContainer>
        <span>x</span>
      </PageContainer>,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass('view-shell');
    expect(shell).toHaveClass('w-full');
  });

  it('merges an extra className without dropping view-shell', () => {
    const { container } = render(
      <PageContainer className="px-8">
        <span>x</span>
      </PageContainer>,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass('view-shell');
    expect(shell).toHaveClass('px-8');
  });

  it('trims trailing space when no className is given', () => {
    const { container } = render(
      <PageContainer>
        <span>x</span>
      </PageContainer>,
    );
    expect(container.firstElementChild?.className).toBe('view-shell w-full');
  });
});
