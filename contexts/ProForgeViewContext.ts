/**
 * ProForge View Context — Three-file pattern for the ProForge pipeline view.
 * QNBS-v3: Context passes useProForgeOrchestrator return to all sub-components.
 */

import { createContext, useContext } from 'react';
import type { UseProForgeOrchestratorReturn } from '../hooks/useProForgeOrchestrator';

export const ProForgeViewContext = createContext<UseProForgeOrchestratorReturn | null>(null);

export function useProForgeViewContext(): UseProForgeOrchestratorReturn {
  const ctx = useContext(ProForgeViewContext);
  if (!ctx) {
    throw new Error('useProForgeViewContext must be used within a ProForgeViewContext.Provider');
  }
  return ctx;
}
