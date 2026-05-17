import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebouncedTextarea } from '../../components/ui/DebouncedTextarea';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../components/ui/Textarea', () => ({
  Textarea: ({
    value,
    onChange,
    ...rest
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  }) => <textarea data-testid="textarea" value={value} onChange={onChange} {...rest} />,
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DebouncedTextarea', () => {
  it('renders with initial value', () => {
    render(<DebouncedTextarea value="hello" onDebouncedChange={vi.fn()} />);
    expect((screen.getByTestId('textarea') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('updates display immediately on change', () => {
    render(<DebouncedTextarea value="" onDebouncedChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'typed text' } });
    expect((screen.getByTestId('textarea') as HTMLTextAreaElement).value).toBe('typed text');
  });

  it('calls onDebouncedChange after default 750ms', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedTextarea value="" onDebouncedChange={onDebouncedChange} />);
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'hello' } });
    expect(onDebouncedChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(750);
    });
    expect(onDebouncedChange).toHaveBeenCalledWith('hello');
  });

  it('does not fire before the debounce window', () => {
    const onDebouncedChange = vi.fn();
    render(<DebouncedTextarea value="" onDebouncedChange={onDebouncedChange} />);
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'hi' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDebouncedChange).not.toHaveBeenCalled();
  });

  it('uses custom debounce timeout', () => {
    const onDebouncedChange = vi.fn();
    render(
      <DebouncedTextarea value="" onDebouncedChange={onDebouncedChange} debounceTimeout={300} />,
    );
    fireEvent.change(screen.getByTestId('textarea'), { target: { value: 'x' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDebouncedChange).toHaveBeenCalledWith('x');
  });

  it('syncs when prop changes externally', () => {
    const { rerender } = render(<DebouncedTextarea value="old" onDebouncedChange={vi.fn()} />);
    rerender(<DebouncedTextarea value="new" onDebouncedChange={vi.fn()} />);
    expect((screen.getByTestId('textarea') as HTMLTextAreaElement).value).toBe('new');
  });
});
