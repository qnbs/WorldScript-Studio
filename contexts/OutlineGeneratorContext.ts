import { createContext, useContext } from 'react';
import type { UseOutlineGeneratorReturnType } from '../hooks/useOutlineGenerator';

export const OutlineGeneratorContext = createContext<UseOutlineGeneratorReturnType | null>(null);

export const useOutlineGeneratorContext = () => {
  const context = useContext(OutlineGeneratorContext);
  if (!context) {
    throw new Error('useOutlineGeneratorContext must be used within an OutlineGeneratorProvider');
  }
  return context;
};
