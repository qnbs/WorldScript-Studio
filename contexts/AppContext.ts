import { createContext, useContext } from 'react';
import type { UseAppReturnType } from '../hooks/useApp';

export const AppContext = createContext<UseAppReturnType | null>(null);

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
