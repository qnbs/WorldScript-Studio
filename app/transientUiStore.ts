import { create } from 'zustand';

interface TransientUiState {
  isCommandPaletteOpen: boolean;
  inspectorPanelWidth: number;
  setCommandPaletteOpen: (value: boolean) => void;
  setInspectorPanelWidth: (value: number) => void;
}

export const useTransientUiStore = create<TransientUiState>((set) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  setCommandPaletteOpen: (value) => set({ isCommandPaletteOpen: value }),
  setInspectorPanelWidth: (value) => set({ inspectorPanelWidth: value }),
}));
