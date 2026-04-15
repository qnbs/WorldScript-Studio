import { createContext, useContext } from 'react';
import type { UseWorldViewReturnType } from '../hooks/useWorldView';

export const WorldViewContext = createContext<UseWorldViewReturnType | null>(null);

export const useWorldViewContext = () => {
  const context = useContext(WorldViewContext);
  if (!context) {
    throw new Error('useWorldViewContext must be used within a WorldViewProvider');
  }
  return context;
};
