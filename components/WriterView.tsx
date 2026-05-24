// QNBS-v3: Thin context-provider shell; sub-components live in components/writing/
import type { FC } from 'react';
import { ProForgeViewContext } from '../contexts/ProForgeViewContext';
import { WriterViewContext } from '../contexts/WriterViewContext';
import { useProForgeOrchestrator } from '../hooks/useProForgeOrchestrator';
import { useWriterView } from '../hooks/useWriterView';
import { WriterViewUI } from './writing/WriterViewUI';

export const WriterView: FC = () => {
  const writerContext = useWriterView();
  const proForgeContext = useProForgeOrchestrator();
  return (
    <WriterViewContext.Provider value={writerContext}>
      <ProForgeViewContext.Provider value={proForgeContext}>
        <WriterViewUI />
      </ProForgeViewContext.Provider>
    </WriterViewContext.Provider>
  );
};
