import type { TypedUseSelectorHook } from 'react-redux';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './store';

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/**
 * Shallow-equal variant — prevents re-renders when an object/array
 * remains structurally equal (new reference, same values).
 * Ideal for selectors that return objects or derived arrays.
 */
export const useAppSelectorShallow = <T>(selector: (state: RootState) => T): T =>
  useSelector(selector, shallowEqual);
