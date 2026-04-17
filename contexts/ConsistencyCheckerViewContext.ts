import { createContext, useContext } from 'react';
import type { Character } from '../types';

interface ConsistencyCheckerViewContextType {
  t: (key: string) => string;
  characters: Character[];
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  checkResult: string;
  isChecking: boolean;
  runCheck: (characterId: string) => void;
}

export const ConsistencyCheckerViewContext =
  createContext<ConsistencyCheckerViewContextType | null>(null);

export const useConsistencyCheckerViewContext = () => {
  const context = useContext(ConsistencyCheckerViewContext);
  if (!context) {
    throw new Error(
      'useConsistencyCheckerViewContext must be used within a ConsistencyCheckerViewContext.Provider',
    );
  }
  return context;
};
