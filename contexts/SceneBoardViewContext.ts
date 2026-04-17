import { createContext, useContext } from 'react';
import type { ProjectData } from '../features/project/projectSlice';
import type { Character, StorySection } from '../types';

interface SceneBoardViewContextType {
  t: (key: string) => string;
  project: ProjectData;
  sections: (StorySection & { position: { x: number; y: number }; wordCount: number })[];
  characters: Character[];
  handleUpdateSection: (id: string, updates: Partial<StorySection>) => void;
  handleDeleteSection: (id: string) => void;
  handleMoveSection: (id: string, position: { x: number; y: number }) => void;
  handleAddSection: () => void;
}

export const SceneBoardViewContext = createContext<SceneBoardViewContextType | null>(null);

export const useSceneBoardViewContext = () => {
  const context = useContext(SceneBoardViewContext);
  if (!context) {
    throw new Error(
      'useSceneBoardViewContext must be used within a SceneBoardViewContext.Provider',
    );
  }
  return context;
};
