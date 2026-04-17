import { createContext, useContext } from 'react';

interface CriticViewContextType {
  t: (key: string) => string;
  analysisResult: string;
  isAnalyzing: boolean;
  analyzeText: (text: string) => void;
  detectPlotHoles: () => void;
}

export const CriticViewContext = createContext<CriticViewContextType | null>(null);

export const useCriticViewContext = () => {
  const context = useContext(CriticViewContext);
  if (!context) {
    throw new Error('useCriticViewContext must be used within a CriticViewContext.Provider');
  }
  return context;
};
