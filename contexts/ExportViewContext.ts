import { createContext, useContext } from 'react';
import type { UseExportViewReturnType } from '../hooks/useExportView';

export const ExportViewContext = createContext<UseExportViewReturnType | null>(null);

export const useExportViewContext = () => {
  const context = useContext(ExportViewContext);
  if (!context) {
    throw new Error('useExportViewContext must be used within a ExportViewProvider');
  }
  return context;
};
