/**
 * Tests for components/ui/Card.tsx — Card, CardContent, CardHeader atoms.
 * QNBS-v3: Pure UI components with no external deps — tests styles and slot composition.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card Body</Card>);
    expect(screen.getByText('Card Body')).toBeInTheDocument();
  });

  it('renders as a <div> by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild?.nodeName).toBe('DIV');
  });

  it('renders as a <button> when as="button"', () => {
    const { container } = render(<Card as="button">Click me</Card>);
    expect(container.firstChild?.nodeName).toBe('BUTTON');
  });

  it('button variant has type="button"', () => {
    const { container } = render(<Card as="button">Click me</Card>);
    expect((container.firstChild as HTMLElement).getAttribute('type')).toBe('button');
  });

  it('applies custom className', () => {
    const { container } = render(<Card className="custom-card">Content</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('custom-card');
  });

  it('passes arbitrary HTML props', () => {
    render(<Card data-testid="my-card">Content</Card>);
    expect(screen.getByTestId('my-card')).toBeInTheDocument();
  });

  it('fires onClick when rendered as button and clicked', () => {
    const handleClick = vi.fn();
    render(
      <Card as="button" onClick={handleClick}>
        Click me
      </Card>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Click me' }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>Details here</CardContent>);
    expect(screen.getByText('Details here')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<CardContent className="my-content">x</CardContent>);
    expect((container.firstChild as HTMLElement).className).toContain('my-content');
  });
});

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>Header Title</CardHeader>);
    expect(screen.getByText('Header Title')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<CardHeader className="my-header">x</CardHeader>);
    expect((container.firstChild as HTMLElement).className).toContain('my-header');
  });
});

describe('Card composition', () => {
  it('renders full card with header and content', () => {
    render(
      <Card>
        <CardHeader>My Story</CardHeader>
        <CardContent>Once upon a time...</CardContent>
      </Card>,
    );
    expect(screen.getByText('My Story')).toBeInTheDocument();
    expect(screen.getByText('Once upon a time...')).toBeInTheDocument();
  });
});
