import { createContext, useContext } from 'react';
import type { Character, CharacterRelationship } from '../types';

interface CharacterGraphViewContextType {
  t: (key: string) => string;
  characters: Character[];
  relationships: CharacterRelationship[];
  onAddRelationship: (fromId: string, toId: string, type: string, strength: number) => void;
  onUpdateRelationship: (relationshipId: string, updates: Partial<CharacterRelationship>) => void;
  onDeleteRelationship: (relationshipId: string) => void;
  onConnect: (fromId: string, toId: string) => void;
}

export const CharacterGraphViewContext = createContext<CharacterGraphViewContextType | null>(null);

export const useCharacterGraphViewContext = () => {
  const context = useContext(CharacterGraphViewContext);
  if (!context) {
    throw new Error(
      'useCharacterGraphViewContext must be used within a CharacterGraphViewContext.Provider'
    );
  }
  return context;
};
