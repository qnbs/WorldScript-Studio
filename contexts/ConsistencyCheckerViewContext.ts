import { createContext, useContext } from 'react';
import type { ConsistencyResult } from '../hooks/useConsistencyCheckerView';
import type { Character, StoryCodex } from '../types';

interface ConsistencyCheckerViewContextType {
  t: (key: string) => string;
  characters: Character[];
  selectedCharacterId: string | null;
  setSelectedCharacterId: (id: string | null) => void;
  checkResult: ConsistencyResult | null;
  isChecking: boolean;
  runCheck: (characterId: string) => void;
  storyCodex: StoryCodex | null;
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
