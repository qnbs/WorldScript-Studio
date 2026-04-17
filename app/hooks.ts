import type { TypedUseSelectorHook } from 'react-redux';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './store';

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/**
 * Shallow-equal variant — verhindert Re-Renders wenn ein Objekt/Array
 * strukturell gleich bleibt (neue Referenz, gleiche Werte).
 * Ideal für Selektoren, die Objekte oder abgeleitete Arrays zurückgeben.
 */
export const useAppSelectorShallow = <T>(selector: (state: RootState) => T): T =>
  useSelector(selector, shallowEqual);
