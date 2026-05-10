import { create } from 'zustand';

interface TransientUiState {
  isCommandPaletteOpen: boolean;
  inspectorPanelWidth: number;
  compileWizardOpen: boolean;
  /** Research binder pinned next to manuscript editor (split view). */
  manuscriptResearchSplitOpen: boolean;
  manuscriptPinnedBinderNodeId: string | null;
  setCommandPaletteOpen: (value: boolean) => void;
  setInspectorPanelWidth: (value: number) => void;
  setCompileWizardOpen: (value: boolean) => void;
  setManuscriptResearchSplitOpen: (value: boolean) => void;
  setManuscriptPinnedBinderNodeId: (id: string | null) => void;
}

export const useTransientUiStore = create<TransientUiState>((set) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  compileWizardOpen: false,
  manuscriptResearchSplitOpen: false,
  manuscriptPinnedBinderNodeId: null,
  setCommandPaletteOpen: (value) => set({ isCommandPaletteOpen: value }),
  setInspectorPanelWidth: (value) => set({ inspectorPanelWidth: value }),
  setCompileWizardOpen: (value) => set({ compileWizardOpen: value }),
  setManuscriptResearchSplitOpen: (value) => set({ manuscriptResearchSplitOpen: value }),
  setManuscriptPinnedBinderNodeId: (id) => set({ manuscriptPinnedBinderNodeId: id }),
}));
