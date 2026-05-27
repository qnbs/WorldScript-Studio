import { create } from 'zustand';

interface TransientUiState {
  isCommandPaletteOpen: boolean;
  inspectorPanelWidth: number;
  compileWizardOpen: boolean;
  /** Research binder pinned next to manuscript editor (split view). */
  manuscriptResearchSplitOpen: boolean;
  manuscriptPinnedBinderNodeId: string | null;
  // QNBS-v3: cross-project search panel (feature-flagged); Zustand avoids prop-drilling to deep command consumers
  isCrossProjectSearchOpen: boolean;
  // X-2: distraction-free writing mode — hides all AI studio panels, leaves only AiScratchpad + exit button
  flowMode: boolean;
  setCommandPaletteOpen: (value: boolean) => void;
  setInspectorPanelWidth: (value: number) => void;
  setCompileWizardOpen: (value: boolean) => void;
  setManuscriptResearchSplitOpen: (value: boolean) => void;
  setManuscriptPinnedBinderNodeId: (id: string | null) => void;
  setCrossProjectSearchOpen: (value: boolean) => void;
  setFlowMode: (value: boolean) => void;
}

export const useTransientUiStore = create<TransientUiState>((set) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  compileWizardOpen: false,
  manuscriptResearchSplitOpen: false,
  manuscriptPinnedBinderNodeId: null,
  isCrossProjectSearchOpen: false,
  flowMode: false,
  setCommandPaletteOpen: (value) => set({ isCommandPaletteOpen: value }),
  setInspectorPanelWidth: (value) => set({ inspectorPanelWidth: value }),
  setCompileWizardOpen: (value) => set({ compileWizardOpen: value }),
  setManuscriptResearchSplitOpen: (value) => set({ manuscriptResearchSplitOpen: value }),
  setManuscriptPinnedBinderNodeId: (id) => set({ manuscriptPinnedBinderNodeId: id }),
  setCrossProjectSearchOpen: (value) => set({ isCrossProjectSearchOpen: value }),
  setFlowMode: (value) => set({ flowMode: value }),
}));
