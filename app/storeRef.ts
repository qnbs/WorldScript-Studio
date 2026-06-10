/**
 * Global store reference for non-React consumers (e.g., voice service, ProForge orchestrator).
 * QNBS-v3: Lives in its own module so importing the ref does NOT pull the entire store/reducer
 * graph into the consumer — keeps hooks/services lightweight and unit-testable in isolation.
 * Type-only imports from './store' are erased at runtime, so there is no runtime dependency cycle.
 */

import type { AppDispatch, RootState } from './store';

export const appStoreRef = {
  current: null as { getState(): RootState; dispatch: AppDispatch } | null,
};
