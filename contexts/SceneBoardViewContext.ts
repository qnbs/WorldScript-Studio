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
  /** World location IDs for scene metadata (sceneLocationId). */
  locationOptions: { id: string; label: string }[];
  connections: PlotConnection[];
  subplots: Subplot[];
  activeSubplotFilter: string | null;
  handleUpdateSection: (id: string, updates: Partial<StorySection>) => void;
  handleDeleteSection: (id: string) => void;
  handleMoveSection: (id: string, position: { x: number; y: number }) => void;
  handleMoveSectionWithinAct: (id: string, direction: 'up' | 'down') => void;
  handleAddSection: () => void;
  handleAddConnection: (from: string, to: string, type?: PlotConnectionType) => void;
  handleDeleteConnection: (id: string) => void;
  handleStartDrawConnection: (fromId: string) => void;
  // QNBS-v3: fromId added to allow ProjectSlice dispatch without reading draw state from plotBoard.
  handleFinishDrawConnection: (toId: string, fromId: string, type?: PlotConnectionType) => void;
  handleCancelDrawConnection: () => void;
  handleAddSubplot: (name: string, color: string) => void;
  handleDeleteSubplot: (id: string) => void;
  handleAssignToSubplot: (sectionId: string, subplotId: string) => void;
  handleRemoveSectionFromSubplot: (sectionId: string, subplotId: string) => void;
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
