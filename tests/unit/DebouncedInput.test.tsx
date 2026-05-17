import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedInput } from '../../components/ui/DebouncedInput';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../components/ui/Input', () => ({
  Input: ({
    value,
    onChange,
    ...rest
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) => <input data-testid="input" value={value} onChange={onChange} {...rest} />,
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DebouncedInput', () => {
  it('renders with initial value', () => {
    render(<DebouncedInput value="hello" onDebouncedChange={vi.fn()} />);
    expect((screen.getByTestId('input') as HTMLInputElement).value).toBe('hello');
  });

  it('updates display immediately as user types', () => {
    render(<DebouncedInput value="" onDebouncedChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'abc' } });
    expect((screen.getByTestId('input') as HTMLInputElement).value).toBe('abc');
  });

  it('calls onDebouncedChange after the default 750ms debounce', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedInput value="" onDebouncedChange={onDebouncedChange} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'hi' } });
    expect(onDebouncedChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(onDebouncedChange).toHaveBeenCalledWith('hi');
  });

  it('does not call onDebouncedChange before the debounce window', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedInput value="" onDebouncedChange={onDebouncedChange} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'test' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDebouncedChange).not.toHaveBeenCalled();
  });

  it('uses a custom debounce timeout', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedInput value="" onDebouncedChange={onDebouncedChange} debounceTimeout={200} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'x' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDebouncedChange).toHaveBeenCalledWith('x');
  });

  it('syncs internal value when prop changes externally', () => {
    const { rerender } = render(<DebouncedInput value="old" onDebouncedChange={vi.fn()} />);
    rerender(<DebouncedInput value="new" onDebouncedChange={vi.fn()} />);
    expect((screen.getByTestId('input') as HTMLInputElement).value).toBe('new');
  });

  it('resets the debounce timer on rapid input', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedInput value="" onDebouncedChange={onDebouncedChange} />);
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'a' } });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    fireEvent.change(screen.getByTestId('input'), { target: { value: 'ab' } });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Only 400ms since the last change — still within debounce window
    expect(onDebouncedChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onDebouncedChange).toHaveBeenCalledTimes(1);
    expect(onDebouncedChange).toHaveBeenCalledWith('ab');
  });
});
