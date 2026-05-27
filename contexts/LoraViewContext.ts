/**
 * LoRA View Context
 * QNBS-v3: Follows the three-file view pattern (component / hook / context).
 */

import { createContext, useContext } from 'react';
import type { useLoraView } from '../hooks/useLoraView';

export type LoraViewContextValue = ReturnType<typeof useLoraView>;

export const LoraViewContext = createContext<LoraViewContextValue | null>(null);

export function useLoraViewContext(): LoraViewContextValue {
  const ctx = useContext(LoraViewContext);
  if (!ctx) throw new Error('useLoraViewContext must be used within LoraViewProvider');
  return ctx;
}
