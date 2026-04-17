import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../components/ui/Button';

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Speichern</Button>);
    expect(screen.getByRole('button', { name: /speichern/i })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Klick mich</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Deaktiviert</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Klick
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders with primary variant by default', () => {
    render(<Button>Primary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/background-interactive/);
  });

  it('renders with secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/background-tertiary/);
  });

  it('renders with danger variant', () => {
    render(<Button variant="danger">Löschen</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/red/);
  });

  it('applies custom className', () => {
    render(<Button className="my-custom-class">Custom</Button>);
    expect(screen.getByRole('button').className).toContain('my-custom-class');
  });

  it('forwards aria attributes', () => {
    render(<Button aria-label="Aktion ausführen">Action</Button>);
    expect(screen.getByLabelText(/aktion ausführen/i)).toBeInTheDocument();
  });

  it('renders small size', () => {
    render(<Button size="sm">Klein</Button>);
    expect(screen.getByRole('button').className).toMatch(/px-3/);
  });

  it('renders large size', () => {
    render(<Button size="lg">Groß</Button>);
    expect(screen.getByRole('button').className).toMatch(/px-8/);
  });
});
