import { createContext, useContext } from 'react';
import type { UseHelpViewReturnType } from '../hooks/useHelpView';

export const HelpViewContext = createContext<UseHelpViewReturnType | null>(null);

export const useHelpViewContext = () => {
  const context = useContext(HelpViewContext);
  if (!context) {
    throw new Error('useHelpViewContext must be used within a HelpViewProvider');
  }
  return context;
};
