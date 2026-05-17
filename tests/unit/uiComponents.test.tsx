/**
 * Batch tests for simple, stateless UI atoms:
 * Spinner, Progress, EmptyState, Tooltip, Card/CardContent/CardHeader,
 * Checkbox, Select, FeatureFlagsContext.
 * QNBS-v3: Covers 8 previously untested UI files in one suite.
 */
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AddNewCard } from '../../components/ui/AddNewCard';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { EmptyState } from '../../components/ui/EmptyState';
import { Progress } from '../../components/ui/Progress';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { Tooltip } from '../../components/ui/Tooltip';
import {
  FeatureFlagsContext,
  FeatureFlagsProvider,
  useFeatureFlags,
} from '../../contexts/FeatureFlagsContext';

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

describe('Spinner', () => {
  it('renders with role="status"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('uses default label "Loading…"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading…');
  });

  it('accepts a custom label', () => {
    render(<Spinner label="Saving data" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Saving data');
  });

  it('applies custom className', () => {
    render(<Spinner className="w-10 h-10" />);
    expect(screen.getByRole('status').className).toContain('w-10 h-10');
  });
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

describe('Progress', () => {
  function getBar(container: HTMLElement) {
    return container.querySelectorAll('div')[1] as HTMLDivElement;
  }

  it('renders a bar with the correct width for 50%', () => {
    const { container } = render(<Progress value={50} />);
    expect(getBar(container).style.width).toBe('50%');
  });

  it('clamps value below 0 to 0%', () => {
    const { container } = render(<Progress value={-10} />);
    expect(getBar(container).style.width).toBe('0%');
  });

  it('clamps value above 100 to 100%', () => {
    const { container } = render(<Progress value={150} />);
    expect(getBar(container).style.width).toBe('100%');
  });
});

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip label="Open menu">
        <button type="button">Menu</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
  });

  it('renders the tooltip text', () => {
    render(
      <Tooltip label="Open menu">
        <button type="button">X</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.getByRole('tooltip').textContent).toBe('Open menu');
  });

  it('appends shortcut to label when provided', () => {
    render(
      <Tooltip label="Save" shortcut="⌘S">
        <button type="button">S</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip').textContent).toBe('Save (⌘S)');
  });
});

// ---------------------------------------------------------------------------
// Card / CardContent / CardHeader
// ---------------------------------------------------------------------------

describe('Card', () => {
  it('renders children', () => {
    render(<Card>hello</Card>);
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('renders as a button when as="button"', () => {
    render(<Card as="button">click me</Card>);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders as a div by default', () => {
    const { container } = render(<Card>content</Card>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>body text</CardContent>);
    expect(screen.getByText('body text')).toBeTruthy();
  });

  it('applies additional className', () => {
    const { container } = render(<CardContent className="extra">x</CardContent>);
    expect(container.firstElementChild?.className).toContain('extra');
  });
});

describe('CardHeader', () => {
  it('renders children', () => {
    render(<CardHeader>header</CardHeader>);
    expect(screen.getByText('header')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Nope" description="Try adding something." />);
    expect(screen.getByText('Try adding something.')).toBeTruthy();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeTruthy();
  });

  it('renders primary action button', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" primaryAction={{ label: 'Add', onClick }} />);
    const btn = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders secondary action button', () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" secondaryAction={{ label: 'Cancel', onClick }} />);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders no description when omitted', () => {
    render(<EmptyState title="Just title" />);
    expect(screen.queryByRole('paragraph')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

describe('Checkbox', () => {
  it('renders a checkbox input', () => {
    render(<Checkbox />);
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  it('renders a label when provided', () => {
    render(<Checkbox id="cb1" label="Remember me" />);
    expect(screen.getByLabelText('Remember me')).toBeTruthy();
  });

  it('forwards ref to the input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<Checkbox ref={ref} />);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('passes checked state', () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('fires onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

describe('Select', () => {
  it('renders a select element', () => {
    render(
      <Select>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('forwards ref', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select ref={ref}>
        <option>x</option>
      </Select>,
    );
    expect(ref.current?.tagName).toBe('SELECT');
  });

  it('passes value and onChange', () => {
    const onChange = vi.fn();
    render(
      <Select value="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('can be disabled', () => {
    render(
      <Select disabled>
        <option>x</option>
      </Select>,
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FeatureFlagsContext
// ---------------------------------------------------------------------------

describe('FeatureFlagsContext', () => {
  const flags = { hybridFallbackEnabled: true } as never;

  it('useFeatureFlags throws without provider', () => {
    expect(() => renderHook(() => useFeatureFlags())).toThrow(
      'useFeatureFlags must be used within FeatureFlagsProvider',
    );
  });

  it('FeatureFlagsProvider provides value', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <FeatureFlagsProvider value={flags}>{children}</FeatureFlagsProvider>
    );
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    expect(result.current).toBe(flags);
  });

  it('FeatureFlagsContext default value is null', () => {
    // The context is created with null as default — verify that invariant
    const { result } = renderHook(() => {
      const { useContext } = require('react') as { useContext: typeof import('react').useContext };
      return useContext(FeatureFlagsContext);
    });
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AddNewCard
// ---------------------------------------------------------------------------

const ICON_PATH = <path d="M12 4.5v15m7.5-7.5h-15" />;

describe('AddNewCard', () => {
  it('renders without throwing', () => {
    expect(() =>
      render(
        <AddNewCard
          onClick={vi.fn()}
          title="New project"
          description="Start from scratch"
          icon={ICON_PATH}
        />,
      ),
    ).not.toThrow();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<AddNewCard onClick={onClick} title="New item" description="Add" icon={ICON_PATH} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders title and description', () => {
    render(
      <AddNewCard
        onClick={vi.fn()}
        title="Create story"
        description="Begin writing"
        icon={ICON_PATH}
      />,
    );
    expect(screen.getByText('Create story')).toBeTruthy();
    expect(screen.getByText('Begin writing')).toBeTruthy();
  });

  it('renders the default variant', () => {
    const { container } = render(
      <AddNewCard onClick={vi.fn()} title="T" description="D" icon={ICON_PATH} variant="default" />,
    );
    expect(container.querySelector('button')).toBeTruthy();
  });
});
