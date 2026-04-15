import { createContext, useContext } from 'react';
import type { UseTemplateViewReturnType } from '../hooks/useTemplateView';

export const TemplateViewContext = createContext<UseTemplateViewReturnType | null>(null);

export const useTemplateViewContext = () => {
  const context = useContext(TemplateViewContext);
  if (!context) {
    throw new Error('useTemplateViewContext must be used within a TemplateViewProvider');
  }
  return context;
};
