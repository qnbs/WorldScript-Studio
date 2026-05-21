import { createContext, useContext } from 'react';
import type { UseCharacterInterviewsViewReturn } from '../hooks/useCharacterInterviewsView';

export const CharacterInterviewsViewContext =
  createContext<UseCharacterInterviewsViewReturn | null>(null);

export function useCharacterInterviewsViewContext(): UseCharacterInterviewsViewReturn {
  const ctx = useContext(CharacterInterviewsViewContext);
  if (!ctx) throw new Error('useCharacterInterviewsViewContext used outside provider');
  return ctx;
}
