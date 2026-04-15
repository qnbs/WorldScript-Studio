import { createContext, useContext } from 'react';
import type { UseWriterViewReturnType } from '../hooks/useWriterView';

export const WriterViewContext = createContext<UseWriterViewReturnType | null>(null);

export const useWriterViewContext = () => {
  const context = useContext(WriterViewContext);
  if (!context) {
    throw new Error('useWriterViewContext must be used within a WriterViewProvider');
  }
  return context;
};
