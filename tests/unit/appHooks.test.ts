import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { useAppDispatch, useAppSelector, useAppSelectorShallow } from '../../app/hooks';

vi.mock('react-redux', () => ({
  shallowEqual: Symbol('shallowEqual'),
  useDispatch: vi.fn(),
  useSelector: vi.fn(),
}));

describe('app/hooks', () => {
  it('useAppDispatch delegates to useDispatch', () => {
    const dispatch = vi.fn();
    const useDispatchMock = vi.mocked(useDispatch);

    useDispatchMock.mockReturnValue(dispatch);

    const appDispatch = useAppDispatch();

    expect(useDispatchMock).toHaveBeenCalledTimes(1);
    expect(appDispatch).toBe(dispatch);
  });

  it('useAppSelector delegates to useSelector with selector only', () => {
    const state = { value: 42 };
    const selector = vi.fn((incoming: typeof state) => incoming.value);
    const useSelectorMock = vi.mocked(useSelector);

    useSelectorMock.mockImplementation(((
      incomingSelector: (incomingState: typeof state) => number,
    ) => incomingSelector(state)) as (selector: unknown) => unknown);

    const selectedValue = useAppSelector(selector as never);

    expect(selectedValue).toBe(42);
    expect(selector).toHaveBeenCalledWith(state);
    expect(useSelectorMock).toHaveBeenCalledTimes(1);
  });

  it('useAppSelectorShallow passes shallowEqual as comparator', () => {
    const selector = vi.fn(() => ({ id: 'value' }));
    const selected = { id: 'value' };
    const useSelectorMock = vi.mocked(useSelector);

    useSelectorMock.mockReturnValue(selected);

    const result = useAppSelectorShallow(selector as never);

    expect(result).toEqual(selected);
    expect(useSelectorMock).toHaveBeenCalledWith(selector, shallowEqual);
  });
});
