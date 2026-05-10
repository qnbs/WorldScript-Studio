import { create } from 'zustand';

interface TransientUiState {
  isCommandPaletteOpen: boolean;
  inspectorPanelWidth: number;
  compileWizardOpen: boolean;
  setCommandPaletteOpen: (value: boolean) => void;
  setInspectorPanelWidth: (value: number) => void;
  setCompileWizardOpen: (value: boolean) => void;
}

export const useTransientUiStore = create<TransientUiState>((set) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  compileWizardOpen: false,
  setCommandPaletteOpen: (value) => set({ isCommandPaletteOpen: value }),
  setInspectorPanelWidth: (value) => set({ inspectorPanelWidth: value }),
  setCompileWizardOpen: (value) => set({ compileWizardOpen: value }),
}));
