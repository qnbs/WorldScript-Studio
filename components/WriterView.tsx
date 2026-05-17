// QNBS-v3: Thin context-provider shell; sub-components live in components/writing/
import type { FC } from 'react';
import { WriterViewContext } from '../contexts/WriterViewContext';
import { useWriterView } from '../hooks/useWriterView';
import { WriterViewUI } from './writing/WriterViewUI';

export const WriterView: FC = () => {
  const contextValue = useWriterView();
  return (
    <WriterViewContext.Provider value={contextValue}>
      <WriterViewUI />
    </WriterViewContext.Provider>
  );
};
