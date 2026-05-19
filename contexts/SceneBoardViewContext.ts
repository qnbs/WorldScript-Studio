import { createContext, useContext } from 'react';
import type { ProjectData } from '../features/project/projectSlice';
import type {
  Character,
  PlotConnection,
  PlotConnectionType,
  StorySection,
  Subplot,
} from '../types';

interface SceneBoardViewContextType {
  t: (key: string, replacements?: Record<string, string>) => string;
  project: ProjectData;
  sections: (StorySection & { position: { x: number; y: number }; wordCount: number })[];
  characters: Character[];
  /** Welt-Ort-IDs für Szenen-Metadaten (sceneLocationId). */
  locationOptions: { id: string; label: string }[];
  connections: PlotConnection[];
  subplots: Subplot[];
  handleUpdateSection: (id: string, updates: Partial<StorySection>) => void;
  handleDeleteSection: (id: string) => void;
  handleMoveSection: (id: string, position: { x: number; y: number }) => void;
  handleMoveSectionWithinAct: (id: string, direction: 'up' | 'down') => void;
  handleAddSection: () => void;
  handleAddConnection: (from: string, to: string, type?: PlotConnectionType) => void;
  handleDeleteConnection: (id: string) => void;
  handleStartDrawConnection: (fromId: string) => void;
  handleFinishDrawConnection: (toId: string, type?: PlotConnectionType) => void;
  handleCancelDrawConnection: () => void;
  handleAddSubplot: (name: string, color: string) => void;
  handleDeleteSubplot: (id: string) => void;
  handleAssignToSubplot: (sectionId: string, subplotId: string) => void;
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
