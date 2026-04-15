import { createContext, useContext, type ReactNode } from 'react';
import type { FeatureFlagsState } from '../features/featureFlags/featureFlagsSlice';

export const FeatureFlagsContext = createContext<FeatureFlagsState | null>(null);

export const FeatureFlagsProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: FeatureFlagsState;
}) => <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;

export const useFeatureFlags = (): FeatureFlagsState => {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error('useFeatureFlags must be used within FeatureFlagsProvider');
  }
  return context;
};
