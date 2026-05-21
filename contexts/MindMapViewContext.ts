import { createContext, useContext } from 'react';
import type { UseMindMapViewReturn } from '../hooks/useMindMapView';

export const MindMapViewContext = createContext<UseMindMapViewReturn | null>(null);

export function useMindMapViewContext(): UseMindMapViewReturn {
  const ctx = useContext(MindMapViewContext);
  if (!ctx)
    throw new Error('useMindMapViewContext must be used within MindMapViewContext.Provider');
  return ctx;
}
