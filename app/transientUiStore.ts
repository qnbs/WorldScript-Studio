import { create } from 'zustand';
import type { HeuristicFinding } from '../services/copilot/heuristicEngine';

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
  // QNBS-v3: B-1 — shown on startup when enableIdbAtRestEncryption is on but key not yet in session
  isIdbUnlockOpen: boolean;
  // QNBS-v3: Copilot overlay state — ephemeral panel-only data lives here, not in Redux
  copilotInsights: HeuristicFinding[];
  copilotHeuristicsOnly: boolean;
  copilotInsightStatus: 'idle' | 'running';
  setCommandPaletteOpen: (value: boolean) => void;
  setInspectorPanelWidth: (value: number) => void;
  setCompileWizardOpen: (value: boolean) => void;
  setManuscriptResearchSplitOpen: (value: boolean) => void;
  setManuscriptPinnedBinderNodeId: (id: string | null) => void;
  setCrossProjectSearchOpen: (value: boolean) => void;
  setFlowMode: (value: boolean) => void;
  setIdbUnlockOpen: (value: boolean) => void;
  setCopilotInsights: (findings: HeuristicFinding[]) => void;
  setCopilotHeuristicsOnly: (value: boolean) => void;
  setCopilotInsightStatus: (status: 'idle' | 'running') => void;
  // QNBS-v3: Phase 2 — shared active section so InlineAnnotationLayer + apply flow can access it
  activeSectionId: string | null;
  setActiveSectionId: (id: string | null) => void;
  // QNBS-v3: CodeAnt — badge click must force-expand the InsightSection; a bool in the store
  // bridges InlineAnnotationLayer (setter) and InsightSection (consumer/reset) without prop-drilling.
  copilotInsightExpanded: boolean;
  setCopilotInsightExpanded: (value: boolean) => void;
  // QNBS-v3: Phase 3 — ProForge "Ask Copilot" chip pre-fills the composer without prop-drilling.
  copilotDraftMessage: string | null;
  setCopilotDraftMessage: (msg: string | null) => void;
  // QNBS-v3: Book Preview → Export hand-off — preselect the Export view's format when arriving
  // from the preview's "Export" button, without coupling the two views or a URL query param.
  exportInitialFormat: string | null;
  setExportInitialFormat: (format: string | null) => void;
}

export const useTransientUiStore = create<TransientUiState>((set) => ({
  isCommandPaletteOpen: false,
  inspectorPanelWidth: 360,
  compileWizardOpen: false,
  manuscriptResearchSplitOpen: false,
  manuscriptPinnedBinderNodeId: null,
  isCrossProjectSearchOpen: false,
  flowMode: false,
  isIdbUnlockOpen: false,
  copilotInsights: [],
  copilotHeuristicsOnly: false,
  copilotInsightStatus: 'idle',
  setCommandPaletteOpen: (value) => set({ isCommandPaletteOpen: value }),
  setInspectorPanelWidth: (value) => set({ inspectorPanelWidth: value }),
  setCompileWizardOpen: (value) => set({ compileWizardOpen: value }),
  setManuscriptResearchSplitOpen: (value) => set({ manuscriptResearchSplitOpen: value }),
  setManuscriptPinnedBinderNodeId: (id) => set({ manuscriptPinnedBinderNodeId: id }),
  setCrossProjectSearchOpen: (value) => set({ isCrossProjectSearchOpen: value }),
  setFlowMode: (value) => set({ flowMode: value }),
  setIdbUnlockOpen: (value) => set({ isIdbUnlockOpen: value }),
  setCopilotInsights: (findings) => set({ copilotInsights: findings }),
  setCopilotHeuristicsOnly: (value) => set({ copilotHeuristicsOnly: value }),
  setCopilotInsightStatus: (status) => set({ copilotInsightStatus: status }),
  activeSectionId: null,
  setActiveSectionId: (id) => set({ activeSectionId: id }),
  copilotInsightExpanded: false,
  setCopilotInsightExpanded: (value) => set({ copilotInsightExpanded: value }),
  copilotDraftMessage: null,
  setCopilotDraftMessage: (msg) => set({ copilotDraftMessage: msg }),
  exportInitialFormat: null,
  setExportInitialFormat: (format) => set({ exportInitialFormat: format }),
}));
