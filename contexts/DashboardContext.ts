import { createContext, useContext } from 'react';
import type { UseDashboardReturnType } from '../hooks/useDashboard';

export const DashboardContext = createContext<UseDashboardReturnType | null>(null);

export const useDashboardContext = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboardContext must be used within a DashboardProvider');
  }
  return context;
};
