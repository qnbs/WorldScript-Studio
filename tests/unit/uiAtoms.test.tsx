/**
 * Tests for simple UI atom components: Checkbox, EmptyState, Select,
 * Spinner, Skeleton, Tooltip, Progress, AddNewCard.
 * QNBS-v3: Pure rendering — no Redux/context deps for most atoms.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AddNewCard } from '../../components/ui/AddNewCard';
import { Checkbox } from '../../components/ui/Checkbox';
import { EmptyState } from '../../components/ui/EmptyState';
import { Progress } from '../../components/ui/Progress';
import { Select } from '../../components/ui/Select';
import { Skeleton } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { Tooltip } from '../../components/ui/Tooltip';

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------
describe('Checkbox', () => {
  it('renders an <input type="checkbox">', () => {
    render(<Checkbox />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Checkbox id="cb1" label="Accept terms" />);
    expect(screen.getByText('Accept terms')).toBeInTheDocument();
  });

  it('label htmlFor matches checkbox id', () => {
    const { container } = render(<Checkbox id="cb2" label="My label" />);
    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe('cb2');
  });

  it('does not render label element when label is omitted', () => {
    const { container } = render(<Checkbox id="cb3" />);
    expect(container.querySelector('label')).toBeNull();
  });

  it('forwards ref to underlying <input>', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Checkbox ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('applies custom className to the checkbox input', () => {
    const { container } = render(<Checkbox className="custom-cls" />);
    const input = container.querySelector('input');
    expect(input?.className).toContain('custom-cls');
  });

  it('forwards disabled prop', () => {
    render(<Checkbox disabled data-testid="cb-disabled" />);
    expect(screen.getByTestId('cb-disabled')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No stories yet" />);
    expect(screen.getByText('No stories yet')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Create your first story" />);
    expect(screen.getByText('Create your first story')).toBeInTheDocument();
  });

  it('renders hint when provided', () => {
    render(<EmptyState title="Empty" hint="Press Ctrl+N to add" />);
    expect(screen.getByText('Press Ctrl+N to add')).toBeInTheDocument();
  });

  it('renders icon content', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">★</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('calls primaryAction.onClick when primary button clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState title="Empty" primaryAction={{ label: 'Create', onClick }} />);
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls secondaryAction.onClick when secondary button clicked', async () => {
    const secondary = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="Empty"
        primaryAction={{ label: 'Create', onClick: vi.fn() }}
        secondaryAction={{ label: 'Cancel', onClick: secondary }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(secondary).toHaveBeenCalledTimes(1);
  });

  it('has role="status" for screen readers', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('does not render action buttons when no actions are provided', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
const SELECT_OPTIONS = [
  { value: 'a', label: 'Option A' },
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
];

describe('Select', () => {
  it('renders a trigger button', () => {
    render(<Select value="a" onChange={vi.fn()} options={SELECT_OPTIONS} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders options when opened', async () => {
    const user = userEvent.setup();
    render(<Select value="a" onChange={vi.fn()} options={SELECT_OPTIONS} ariaLabel="Test" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: 'X' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Y' })).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Select value="a" onChange={vi.fn()} options={SELECT_OPTIONS} className="my-select" />,
    );
    expect(container.querySelector('.my-select')).toBeInTheDocument();
  });

  it('forwards disabled prop', () => {
    render(<Select value="a" onChange={vi.fn()} options={SELECT_OPTIONS} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
describe('Spinner', () => {
  it('renders a status element', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses default aria-label when no label provided', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading…');
  });

  it('uses custom aria-label when label provided', () => {
    render(<Spinner label="Saving document" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Saving document');
  });

  it('applies custom className', () => {
    render(<Spinner className="w-10 h-10" />);
    expect(screen.getByRole('status').className).toContain('w-10 h-10');
  });
});

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
describe('Skeleton', () => {
  it('renders a div with animate-pulse class', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain('animate-pulse');
  });

  it('applies custom className', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect((container.firstChild as HTMLElement).className).toContain('h-4 w-32');
  });
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip label="Save">
        <button type="button">Save</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders tooltip label in a tooltip role', () => {
    render(
      <Tooltip label="Save file">
        <span>icon</span>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save file');
  });

  it('includes shortcut in tooltip when provided', () => {
    render(
      <Tooltip label="Save" shortcut="Ctrl+S">
        <span>icon</span>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save (Ctrl+S)');
  });

  it('tooltip element is linked via aria-describedby', () => {
    render(
      <Tooltip label="Delete">
        <button type="button">Delete</button>
      </Tooltip>,
    );
    const tooltip = screen.getByRole('tooltip');
    const button = screen.getByRole('button');
    const describedBy = button.closest('[aria-describedby]') ?? button;
    expect(describedBy.getAttribute('aria-describedby')).toBe(tooltip.id);
  });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
describe('Progress', () => {
  it('renders a progress bar container', () => {
    const { container } = render(<Progress aria-label="Progress" value={50} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('sets bar width to the given percentage', () => {
    const { container } = render(<Progress aria-label="Progress" value={75} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('75%');
  });

  it('clamps value below 0 to 0%', () => {
    const { container } = render(<Progress aria-label="Progress" value={-10} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('0%');
  });

  it('clamps value above 100 to 100%', () => {
    const { container } = render(<Progress aria-label="Progress" value={150} />);
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
  });

  it('applies custom className to the outer element', () => {
    const { container } = render(
      <Progress aria-label="Progress" value={50} className="my-progress" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-progress');
  });
});

// ---------------------------------------------------------------------------
// AddNewCard
// ---------------------------------------------------------------------------
describe('AddNewCard', () => {
  it('renders title and description', () => {
    render(
      <AddNewCard
        title="New Story"
        description="Start a blank story"
        onClick={vi.fn()}
        icon={<path d="M12 5v14" />}
      />,
    );
    expect(screen.getByText('New Story')).toBeInTheDocument();
    expect(screen.getByText('Start a blank story')).toBeInTheDocument();
  });

  it('renders as a <button> element', () => {
    render(
      <AddNewCard title="Add" description="desc" onClick={vi.fn()} icon={<path d="M12 5v14" />} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <AddNewCard title="Add" description="desc" onClick={onClick} icon={<path d="M12 5v14" />} />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders with default primary variant', () => {
    const { container } = render(
      <AddNewCard title="Add" description="desc" onClick={vi.fn()} icon={<path d="M12 5v14" />} />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('from-[var(--sc-accent)]');
  });

  it('renders with default variant when variant="default"', () => {
    const { container } = render(
      <AddNewCard
        title="Add"
        description="desc"
        onClick={vi.fn()}
        icon={<path d="M12 5v14" />}
        variant="default"
      />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('border-dashed');
  });
});
