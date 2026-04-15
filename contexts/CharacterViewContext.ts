import { createContext, useContext } from 'react';
import type { UseCharacterViewReturnType } from '../hooks/useCharacterView';

export const CharacterViewContext = createContext<UseCharacterViewReturnType | null>(null);

export const useCharacterViewContext = () => {
  const context = useContext(CharacterViewContext);
  if (!context) {
    throw new Error('useCharacterViewContext must be used within a CharacterViewProvider');
  }
  return context;
};
